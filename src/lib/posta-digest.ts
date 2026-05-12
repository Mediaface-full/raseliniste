/**
 * Pošta — digest generator.
 *
 * 1× denně 7:00 ráno (cron `posta-digest`) generuje EmailDigest snapshot
 * pro daný den. Manuálně spustitelný přes UI tlačítko (později).
 *
 * Schema content JSON — viz EmailDigest model v prisma/schema.prisma.
 *
 * **Verze 1 (faze 3):** mechanická agregace + Gemini Flash summary 1-2 věty.
 * Mockup v INSTRUKCE/POSTA-PHASE-3.md (SPEC.md zatím neexistuje, formát
 * se může změnit když Petr pošle finální mockup — JSON content je
 * intentionally loose, breaking změna by byla minimal).
 */

import { prisma } from "./db";
import { getGemini, DEFAULT_MODEL } from "./gemini";
import { trackGeminiCall } from "./gemini-usage";

interface DigestContent {
  topActions: Array<{
    emailId: string;
    subject: string;
    fromName: string | null;
    urgency: string;
    suggestedAction: string | null;
    reason: string;
  }>;
  escalations: Array<{
    emailId: string;
    subject: string;
    fromName: string | null;
    urgency: string;
    reason: string;
  }>;
  waitingExternal: Array<{
    emailId: string;
    subject: string;
    toAddresses: string[];
    since: string; // ISO date
  }>;
  counts: {
    actionType: Record<string, number>;
    contentType: Record<string, number>;
  };
  summary: string;
  model: string;
  totalActiveEmails: number;
}

export interface DigestStats {
  userId: string;
  ok: boolean;
  digestId?: string;
  reused?: boolean; // už existoval, neobnovili jsme (default behavior)
  forDate: string;
  totalActiveEmails: number;
  durationMs: number;
  error?: string;
}

/**
 * Vytvoří / aktualizuje digest pro daného uživatele a den.
 *
 * Default behavior: pokud digest pro daný den už existuje, NEPRECREATEUJEME
 * (cron se může opakovat omylem, idempotence). S `force: true` přepíšeme.
 */
export async function generateDigestForUser(
  userId: string,
  options: { force?: boolean; date?: Date } = {},
): Promise<DigestStats> {
  const start = Date.now();
  const forDate = options.date ?? today();

  const stats: DigestStats = {
    userId,
    ok: false,
    forDate: forDate.toISOString().slice(0, 10),
    totalActiveEmails: 0,
    durationMs: 0,
  };

  try {
    const existing = await prisma.emailDigest.findUnique({
      where: { userId_forDate: { userId, forDate } },
    });
    if (existing && !options.force) {
      stats.ok = true;
      stats.reused = true;
      stats.digestId = existing.id;
      stats.totalActiveEmails =
        ((existing.content as DigestContent | null)?.totalActiveEmails) ?? 0;
      stats.durationMs = Date.now() - start;
      return stats;
    }

    // Načti aktivní maily s klasifikací — pro topActions, escalations atd.
    const activeEmails = await prisma.emailMessage.findMany({
      where: {
        userId,
        resolvedAt: null,
        classification: { isNot: null },
      },
      include: { classification: true },
      orderBy: { receivedAt: "desc" },
      take: 200, // max okno pro digest analýzu
    });

    stats.totalActiveEmails = activeEmails.length;

    // --- Top actions (action_required, sorted by urgency + receivedAt) ---
    const urgencyRank = { high: 3, medium: 2, low: 1 };
    const topActions = activeEmails
      .filter((e) => e.classification?.actionType === "action_required")
      .sort((a, b) => {
        const ua = urgencyRank[(a.classification?.urgency ?? "low") as keyof typeof urgencyRank] ?? 0;
        const ub = urgencyRank[(b.classification?.urgency ?? "low") as keyof typeof urgencyRank] ?? 0;
        if (ua !== ub) return ub - ua;
        return b.receivedAt.getTime() - a.receivedAt.getTime();
      })
      .slice(0, 10)
      .map((e) => ({
        emailId: e.id,
        subject: e.subject ?? "(bez předmětu)",
        fromName: e.fromName,
        urgency: e.classification?.urgency ?? "low",
        suggestedAction: e.classification?.suggestedAction ?? null,
        reason: e.classification?.reason ?? "",
      }));

    // --- Escalations (escalation=true OR urgency=high), top 10 ---
    const escalations = activeEmails
      .filter((e) => e.classification?.escalation || e.classification?.urgency === "high")
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .slice(0, 10)
      .map((e) => ({
        emailId: e.id,
        subject: e.subject ?? "(bez předmětu)",
        fromName: e.fromName,
        urgency: e.classification?.urgency ?? "low",
        reason: e.classification?.reason ?? "",
      }));

    // --- Waiting external (top 10) ---
    const waitingExternal = activeEmails
      .filter((e) => e.classification?.actionType === "waiting_external")
      .slice(0, 10)
      .map((e) => ({
        emailId: e.id,
        subject: e.subject ?? "(bez předmětu)",
        toAddresses: e.toAddresses,
        since: e.receivedAt.toISOString(),
      }));

    // --- Counts ---
    const actionCounts: Record<string, number> = {};
    const contentCounts: Record<string, number> = {};
    for (const e of activeEmails) {
      const at = e.classification?.actionType;
      const ct = e.classification?.contentType;
      if (at) actionCounts[at] = (actionCounts[at] ?? 0) + 1;
      if (ct) contentCounts[ct] = (contentCounts[ct] ?? 0) + 1;
    }

    // --- LLM summary (1-2 věty reflexe) ---
    const summary = await generateSummary({
      topActions: topActions.length,
      escalations: escalations.length,
      waiting: waitingExternal.length,
      total: activeEmails.length,
      actionCounts,
      contentCounts,
      topActionSamples: topActions.slice(0, 3).map((a) => a.subject),
    });

    const content: DigestContent = {
      topActions,
      escalations,
      waitingExternal,
      counts: { actionType: actionCounts, contentType: contentCounts },
      summary,
      model: DEFAULT_MODEL,
      totalActiveEmails: activeEmails.length,
    };

    const digest = await prisma.emailDigest.upsert({
      where: { userId_forDate: { userId, forDate } },
      create: {
        userId,
        forDate,
        content: content as unknown as object,
      },
      update: {
        content: content as unknown as object,
        generatedAt: new Date(),
        viewedAt: null, // reset
      },
    });

    stats.ok = true;
    stats.digestId = digest.id;
  } catch (err) {
    stats.error = err instanceof Error ? err.message : String(err);
    console.warn(`[posta-digest] userId=${userId} FAILED: ${stats.error.slice(0, 300)}`);
  }

  stats.durationMs = Date.now() - start;
  console.log(
    `[posta-digest] userId=${userId} forDate=${stats.forDate} ok=${stats.ok} reused=${stats.reused ?? false} total=${stats.totalActiveEmails} duration=${stats.durationMs}ms`,
  );
  return stats;
}

async function generateSummary(input: {
  topActions: number;
  escalations: number;
  waiting: number;
  total: number;
  actionCounts: Record<string, number>;
  contentCounts: Record<string, number>;
  topActionSamples: string[];
}): Promise<string> {
  // Pokud žádná data, nepouštíme LLM call
  if (input.total === 0) {
    return "Žádná aktivní pošta. Klid.";
  }

  const start = Date.now();
  try {
    const genai = getGemini();
    const prompt = `Jsi asistent ktery generuje 1-2 vetne shrnuti dne pro Petrovu Postu.
Petr ma CPTSD + ADHD — bud klidny a vecny, ne dramaticky.

DATA:
- Aktivni mailu celkem: ${input.total}
- Vyzaduje akci: ${input.topActions}
- Eskalace (urgent/eskalovany): ${input.escalations}
- Ceka na druhou stranu: ${input.waiting}
- Rozlozeni dle obsahu: ${Object.entries(input.contentCounts).map(([k, v]) => `${k}:${v}`).join(", ")}
${input.topActionSamples.length > 0 ? `\nPriklady action_required:\n${input.topActionSamples.map((s) => `- ${s}`).join("\n")}` : ""}

Vrat 1-2 vety summary v cestine. Priklad stylu:
"Dnes te ceka 5 ukolu k vyrizeni, z toho 2 eskalovane (faktury, klient TK). Zbytek je prevazne newsletter — muzes prejit rychle."

Zadny markdown, zadny code fence. Jen text odpovedi.`;

    const response = await genai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: prompt,
      config: {
        temperature: 0.4,
        maxOutputTokens: 200,
      },
    });
    void trackGeminiCall({
      module: "posta-digest-summary",
      response,
      modelName: DEFAULT_MODEL,
      durationMs: Date.now() - start,
    });

    const text = (response.text ?? "").trim();
    if (!text) return fallbackSummary(input);
    return text;
  } catch (err) {
    console.warn(
      `[posta-digest] summary LLM failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return fallbackSummary(input);
  }
}

function fallbackSummary(input: { topActions: number; escalations: number; total: number }): string {
  const parts: string[] = [];
  if (input.topActions > 0) {
    parts.push(`${input.topActions} mailů čeká na akci`);
  }
  if (input.escalations > 0) {
    parts.push(`${input.escalations} eskalací`);
  }
  if (parts.length === 0) {
    return `${input.total} aktivních mailů, žádný urgentní.`;
  }
  return parts.join(", ") + ".";
}

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
