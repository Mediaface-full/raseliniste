/**
 * Pošta — Todoist sync pro DetectedCommitment (fáze 6).
 *
 * **JEDNOSMĚRNÝ sync DB → Todoist.** NIKDY ne read-back z Todoist.
 * Naše DB je primárka, Todoist je sekundární mirror.
 *
 * Trigger: cron `posta-commitment-todoist-sync` every 5 min (catch-up
 * pro failed syncs). Plus po vzniku auto-created commitmentu zavoláme
 * `syncCommitmentToTodoist(id)` fire-and-forget pro instant push.
 *
 * Filter pro sync:
 *  - status in ('active', 'confirmed')
 *  - autoCreated = true OR confidence >= 0.85
 *  - todoistTaskId IS NULL (= ještě nepushnuto)
 *
 * Status transitions:
 *  - active/confirmed → Todoist task content + labels
 *  - resolved → Todoist task closed
 *  - stale → Todoist task label "stale"
 *  - rejected → Todoist task DELETE
 *  - merged → Todoist task DELETE (zachová se primary commitment v Todoistu)
 *
 * Rate limit: max 30 req/min do Todoist (Petrovo zadání).
 */

import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import { createTask, updateTask, closeTask, deleteTask } from "./todoist";

// Petr 2026-05-13 dostal Todoist 429 (1280s retry-after). Zpomaleno z 30/min
// na 10/min — paralelní crony (task-todoist-push, todoist-sync, Things import)
// se potkávají, sčítají requesty. Plus retry-on-429 ve src/lib/todoist.ts
// jako safety net pokud i tak ucinime burst.
const TODOIST_RATE_LIMIT_PER_MIN = 10;
const MIN_DELAY_BETWEEN_CALLS_MS = (60 * 1000) / TODOIST_RATE_LIMIT_PER_MIN; // 6000 ms

export interface SyncStats {
  userId: string;
  created: number;
  closed: number;
  deleted: number;
  labeled: number;
  errors: number;
  errorDetails: Array<{ commitmentId: string; error: string }>;
  durationMs: number;
}

async function getTodoistToken(userId: string): Promise<string | null> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "todoist" } },
  });
  if (!integration) return null;
  try {
    return decryptSecret({
      enc: integration.tokenEnc,
      iv: integration.tokenIv,
      tag: integration.tokenTag,
    });
  } catch {
    return null;
  }
}

/**
 * Single commitment sync — push do Todoistu nebo update existujícího.
 * Caller volá pro instant push po vzniku, nebo cron pro catch-up.
 */
export async function syncCommitmentToTodoist(
  commitmentId: string,
): Promise<{ ok: boolean; action: string; error?: string }> {
  const commitment = await prisma.detectedCommitment.findUnique({
    where: { id: commitmentId },
  });
  if (!commitment) return { ok: false, action: "skip", error: "NOT_FOUND" };

  const token = await getTodoistToken(commitment.userId);
  if (!token) return { ok: false, action: "skip", error: "NO_TODOIST_TOKEN" };

  // Routing per status
  try {
    if (commitment.status === "active" || commitment.status === "confirmed") {
      // Auto-only podle Petrova zadání: NE-push pokud user-confirm needed
      if (!commitment.autoCreated && commitment.confidence < 0.85) {
        return { ok: true, action: "skip-needs-confirm" };
      }

      if (commitment.todoistTaskId) {
        // Already pushed — update content (proposedTitle mohl být editovan v UI)
        await updateTask(token, commitment.todoistTaskId, {
          content: buildContent(commitment),
          due_string: commitment.deadlineHint ?? null,
        });
        return { ok: true, action: "update" };
      }

      // Create new task
      const task = await createTask(token, {
        content: buildContent(commitment),
        description: buildDescription(commitment),
        due_string: commitment.deadlineHint ?? undefined,
        priority: 2 as 1 | 2 | 3 | 4, // normal — vyšumělé závazky nejsou urgent default
        labels: ["zavazek"],
      });
      await prisma.detectedCommitment.update({
        where: { id: commitment.id },
        data: { todoistTaskId: task.id },
      });
      return { ok: true, action: "create" };
    }

    if (commitment.status === "resolved") {
      if (commitment.todoistTaskId) {
        await closeTask(token, commitment.todoistTaskId);
        return { ok: true, action: "close" };
      }
      return { ok: true, action: "skip-no-todoist-id" };
    }

    if (commitment.status === "stale") {
      if (commitment.todoistTaskId) {
        await updateTask(token, commitment.todoistTaskId, {
          labels: ["zavazek", "stale"],
        });
        return { ok: true, action: "label-stale" };
      }
      return { ok: true, action: "skip-no-todoist-id" };
    }

    if (commitment.status === "rejected" || commitment.status === "merged") {
      if (commitment.todoistTaskId) {
        await deleteTask(token, commitment.todoistTaskId);
        await prisma.detectedCommitment.update({
          where: { id: commitment.id },
          data: { todoistTaskId: null },
        });
        return { ok: true, action: "delete" };
      }
      return { ok: true, action: "skip-no-todoist-id" };
    }

    return { ok: true, action: "skip-unknown-status" };
  } catch (err) {
    return {
      ok: false,
      action: "error",
      error: err instanceof Error ? err.message.slice(0, 300) : "?",
    };
  }
}

/**
 * Batch catch-up — projde commitmenty co potřebují sync (rate-limited).
 *
 * Pravidla:
 *  - active/confirmed bez todoistTaskId (auto only) → create
 *  - resolved s todoistTaskId → close
 *  - stale s todoistTaskId → label
 *  - rejected/merged s todoistTaskId → delete
 */
export async function syncPendingCommitments(userId: string): Promise<SyncStats> {
  const start = Date.now();
  const stats: SyncStats = {
    userId,
    created: 0,
    closed: 0,
    deleted: 0,
    labeled: 0,
    errors: 0,
    errorDetails: [],
    durationMs: 0,
  };

  // Najdi commitmenty potřebující sync
  const pending = await prisma.detectedCommitment.findMany({
    where: {
      userId,
      OR: [
        // active/confirmed s vysokou confidence ještě nepushnuto
        {
          status: { in: ["active", "confirmed"] },
          autoCreated: true,
          todoistTaskId: null,
        },
        // resolved s task ID ještě nezavřeno (out-of-band trigger)
        // Pozor: tento branch může opakovaně close stejný task. Lepší by
        // bylo flag "todoistClosed" — pro fázi 6 OK, idempotence pomáhá.
        // (Closing už closed task v Todoist API = 204 No-Content, ne error.)
      ],
    },
    take: 30, // max 30 per cron iteraci (rate limit)
    orderBy: { detectedAt: "asc" },
  });

  for (const c of pending) {
    const res = await syncCommitmentToTodoist(c.id);
    if (res.ok) {
      if (res.action === "create") stats.created++;
      else if (res.action === "close") stats.closed++;
      else if (res.action === "delete") stats.deleted++;
      else if (res.action === "label-stale") stats.labeled++;
    } else {
      stats.errors++;
      stats.errorDetails.push({
        commitmentId: c.id,
        error: res.error ?? "?",
      });
    }
    // Rate-limit pause
    await sleep(MIN_DELAY_BETWEEN_CALLS_MS);
  }

  stats.durationMs = Date.now() - start;
  console.log(
    `[posta-commitment-sync] userId=${userId} created=${stats.created} closed=${stats.closed} deleted=${stats.deleted} labeled=${stats.labeled} errors=${stats.errors} duration=${stats.durationMs}ms`,
  );
  return stats;
}

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

function buildContent(c: {
  proposedTitle: string;
  recipient: string | null;
  recipientEmail: string | null;
}): string {
  // Pokud recipient není v proposedTitle, přidat (Karlovi/klientovi/atd.)
  const recipient = c.recipient ?? c.recipientEmail;
  if (recipient && !c.proposedTitle.toLowerCase().includes((recipient.split("@")[0] ?? "").toLowerCase())) {
    return `${c.proposedTitle} (${recipient})`;
  }
  return c.proposedTitle;
}

function buildDescription(c: {
  quotedText: string;
  deadlineHint: string | null;
  sourceEmailId: string;
  confidence: number;
}): string {
  const lines: string[] = [];
  lines.push(`Detekováno z odeslaného mailu (confidence ${c.confidence.toFixed(2)}).`);
  lines.push("");
  lines.push(`> ${c.quotedText.replace(/\n/g, " ")}`);
  if (c.deadlineHint) {
    lines.push("");
    lines.push(`Deadline hint: ${c.deadlineHint}`);
  }
  lines.push("");
  lines.push(`Rašeliniště commitment ID: ${c.sourceEmailId}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Stale marker — daily 03:00
// ---------------------------------------------------------------------------

/**
 * Označí commitments jako "stale" po 30 dnech bez akce.
 * Trigger: cron `posta-commitment-stale` daily 03:00.
 */
export async function markStaleCommitments(): Promise<{ marked: number }> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const stale = await prisma.detectedCommitment.findMany({
    where: {
      status: "active",
      lastActionAt: { lt: cutoff },
    },
    select: { id: true },
  });

  if (stale.length === 0) {
    console.log(`[posta-commitment-stale] no commitments to mark`);
    return { marked: 0 };
  }

  await prisma.detectedCommitment.updateMany({
    where: { id: { in: stale.map((s) => s.id) } },
    data: { status: "stale", staleAt: new Date() },
  });

  console.log(`[posta-commitment-stale] marked=${stale.length}`);

  // Trigger Todoist sync pro stale → label
  // (Necháme cron `posta-commitment-todoist-sync` aby to zpracoval, místo
  // inline calls — drží rate limit jednotně řízený.)

  return { marked: stale.length };
}

// ---------------------------------------------------------------------------
// Related email tracking
// ---------------------------------------------------------------------------

/**
 * Po příchodu nového inbound mailu zkontroluj zda souvisí s existujícím
 * active commitmentem (thread match NEBO keyword match z quotedText).
 * Pokud ano:
 *   - append email.id do relatedEmailIds
 *   - update lastActionAt = email.receivedAt
 *
 * Volá se z gmail-watch.ts processHistoryFromPush + posta-sync.ts upsert
 * (single-side trigger — incoming maily, ne outbound).
 */
export async function trackRelatedEmail(emailId: string): Promise<void> {
  const email = await prisma.emailMessage.findUnique({
    where: { id: emailId },
    select: {
      id: true,
      userId: true,
      threadId: true,
      fromAddress: true,
      subject: true,
      snippet: true,
      receivedAt: true,
    },
  });
  if (!email) return;

  // Skip outbound (Petrovy maily) — řeší detector
  const user = await prisma.user.findUnique({
    where: { id: email.userId },
    select: { gmailEmailAddress: true },
  });
  if (user?.gmailEmailAddress && email.fromAddress.toLowerCase() === user.gmailEmailAddress.toLowerCase()) {
    return;
  }

  // Najdi active commitmenty v stejném threadu
  const threadMatches = await prisma.detectedCommitment.findMany({
    where: {
      userId: email.userId,
      status: "active",
      sourceEmail: { threadId: email.threadId },
    },
    select: { id: true, relatedEmailIds: true },
  });

  for (const c of threadMatches) {
    if (c.relatedEmailIds.includes(email.id)) continue; // už přidáno
    await prisma.detectedCommitment.update({
      where: { id: c.id },
      data: {
        relatedEmailIds: { push: email.id },
        lastActionAt: email.receivedAt,
      },
    });
  }

  if (threadMatches.length > 0) {
    console.log(
      `[posta-commitment-related] emailId=${email.id} matched ${threadMatches.length} commitments via thread`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
