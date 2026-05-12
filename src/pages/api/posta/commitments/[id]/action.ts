import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { invalidatePostaBadgeCache } from "@/lib/posta-badge";
import { syncCommitmentToTodoist } from "@/lib/posta-commitment-sync";

export const prerender = false;

/**
 * POST /api/posta/commitments/:id/action
 *
 * Form-driven action endpoint pro UI tlačítka v /posta sekci Závazky.
 * Akce: confirm | reject | resolve | postpone | merge | unmerge
 *
 * Form body:
 *   action=<typ>
 *   from=<redirect URL>
 *   reason=<rejection reason, jen pro reject>
 *   targetId=<primary commitment id, jen pro merge>
 *   editTitle=<new proposedTitle, volitelne pri confirm>
 */
export const POST: APIRoute = async ({ params, cookies, request, redirect }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "INVALID_FORM" }, { status: 400 });

  const action = String(form.get("action") ?? "");
  const back = String(form.get("from") ?? "/posta?section=commitments");
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : "/posta?section=commitments";

  const commitment = await prisma.detectedCommitment.findFirst({
    where: { id, userId: session.uid },
  });
  if (!commitment) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const now = new Date();
  let triggerSync = false;

  switch (action) {
    case "confirm": {
      const editTitle = String(form.get("editTitle") ?? "").trim();
      await prisma.detectedCommitment.update({
        where: { id },
        data: {
          status: "confirmed",
          confirmedAt: now,
          lastActionAt: now,
          autoCreated: true, // user explicit confirm = trigger Todoist sync
          ...(editTitle && editTitle !== commitment.proposedTitle ? { proposedTitle: editTitle } : {}),
        },
      });
      triggerSync = true;
      break;
    }
    case "reject": {
      const reason = (String(form.get("reason") ?? "")).slice(0, 1000) || null;
      await prisma.detectedCommitment.update({
        where: { id },
        data: {
          status: "rejected",
          rejectedAt: now,
          lastActionAt: now,
          rejectionReason: reason,
        },
      });
      triggerSync = true; // delete Todoist task if existed
      break;
    }
    case "resolve": {
      await prisma.detectedCommitment.update({
        where: { id },
        data: { status: "resolved", resolvedAt: now, lastActionAt: now },
      });
      triggerSync = true;
      break;
    }
    case "postpone": {
      // Vratit lastActionAt o 7 dni do budoucna (= ne-stale dalsich 30+7 dni)
      const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      await prisma.detectedCommitment.update({
        where: { id },
        data: { lastActionAt: future },
      });
      break;
    }
    case "unstale": {
      // Vrátit ze stale zpět do active (uživatel explicitně chce pokračovat)
      await prisma.detectedCommitment.update({
        where: { id },
        data: { status: "active", staleAt: null, lastActionAt: now },
      });
      triggerSync = true;
      break;
    }
    case "merge": {
      // Sloučit tento commitment do `targetId` jako primary
      const targetId = String(form.get("targetId") ?? "");
      if (!targetId) return Response.json({ error: "MISSING_TARGET" }, { status: 400 });
      const target = await prisma.detectedCommitment.findFirst({
        where: { id: targetId, userId: session.uid },
      });
      if (!target) return Response.json({ error: "TARGET_NOT_FOUND" }, { status: 404 });

      await prisma.detectedCommitment.update({
        where: { id },
        data: { status: "merged", mergedInto: targetId, lastActionAt: now },
      });
      // Aktualizovat lastActionAt na primary (relate signal)
      await prisma.detectedCommitment.update({
        where: { id: targetId },
        data: { lastActionAt: now },
      });
      triggerSync = true; // delete Todoist pro tento, primary nepuze
      break;
    }
    default:
      return Response.json({ error: "INVALID_ACTION" }, { status: 400 });
  }

  invalidatePostaBadgeCache(session.uid);

  // Trigger Todoist sync fire-and-forget
  if (triggerSync) {
    void syncCommitmentToTodoist(id).catch((e) => {
      console.warn(
        `[posta-commitment-action] todoist sync failed: ${e instanceof Error ? e.message : e}`,
      );
    });
  }

  return redirect(safeBack);
};
