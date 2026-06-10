import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { listAllCollaborators } from "@/lib/todoist";

export const prerender = false;

/**
 * POST /api/integrations/todoist/auto-link-collaborators  (Petr 2026-06-10)
 *
 * Spáruje Todoist collaborators s lokálními Contacts podle e-mailové adresy
 * (case-insensitive). Pro každý match vyplní Contact.todoistUserId, aby
 * task-todoist-push.ts posílal `responsible_uid` a člen týmu dostal
 * notifikaci místo jen úkolu v sekci s jeho jménem.
 *
 * Bezpečnost:
 *   - Pouze updatuje existující Contact (nevytváří nové)
 *   - Neoverridne existující todoistUserId (idempotentní)
 *   - Vrací audit log per kontakt (matched / skipped / no-email)
 *
 * Response: { ok, summary: { matched, skipped, noEmail, missing }, log: [...] }
 */
export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId: session.uid, provider: "todoist" } },
  });
  if (!integration) {
    return Response.json({ error: "TODOIST_NOT_CONFIGURED" }, { status: 400 });
  }

  const token = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });

  let collaborators: Array<{ id: string; name?: string | null; email?: string | null }>;
  try {
    collaborators = await listAllCollaborators(token);
  } catch (e) {
    return Response.json(
      { ok: false, error: `Todoist API: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  // Mapa email (lowercase) → todoistUserId
  const byEmail = new Map<string, { id: string; name?: string | null }>();
  for (const c of collaborators) {
    if (c.email && c.id) {
      byEmail.set(c.email.toLowerCase().trim(), { id: c.id, name: c.name ?? null });
    }
  }

  // Načti všechny kontakty s emaily + jejich aktuální todoistUserId
  const contacts = await prisma.contact.findMany({
    where: { userId: session.uid },
    select: {
      id: true,
      displayName: true,
      todoistUserId: true,
      isTeam: true,
      emails: { select: { email: true } },
    },
  });

  const log: Array<{ contactId: string; displayName: string; status: string; matchedTodoistId?: string; matchedEmail?: string }> = [];
  let matched = 0;
  let skipped = 0;
  let noEmail = 0;

  for (const contact of contacts) {
    if (contact.todoistUserId) {
      skipped++;
      log.push({ contactId: contact.id, displayName: contact.displayName, status: `already-set (${contact.todoistUserId})` });
      continue;
    }
    if (contact.emails.length === 0) {
      noEmail++;
      log.push({ contactId: contact.id, displayName: contact.displayName, status: "no-email" });
      continue;
    }

    let found: { id: string; matchedEmail: string } | null = null;
    for (const e of contact.emails) {
      const m = byEmail.get(e.email.toLowerCase().trim());
      if (m) {
        found = { id: m.id, matchedEmail: e.email };
        break;
      }
    }
    if (found) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { todoistUserId: found.id },
      });
      matched++;
      log.push({
        contactId: contact.id,
        displayName: contact.displayName,
        status: "matched",
        matchedTodoistId: found.id,
        matchedEmail: found.matchedEmail,
      });
    } else {
      log.push({ contactId: contact.id, displayName: contact.displayName, status: "no-match" });
    }
  }

  // Counter „missing" = Todoist collaborators bez Contact match (informativní)
  const matchedTodoistIds = new Set(
    log.filter((l) => l.matchedTodoistId).map((l) => l.matchedTodoistId!),
  );
  const missingCollabs = collaborators.filter((c) => c.id && !matchedTodoistIds.has(c.id));

  return Response.json({
    ok: true,
    summary: {
      matched,
      skipped,
      noEmail,
      totalCollaborators: collaborators.length,
      unmatchedCollaborators: missingCollabs.length,
    },
    log,
    unmatchedCollaborators: missingCollabs.map((c) => ({ id: c.id, name: c.name, email: c.email })),
  });
};
