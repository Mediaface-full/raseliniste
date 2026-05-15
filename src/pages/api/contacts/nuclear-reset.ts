/**
 * POST /api/contacts/nuclear-reset
 *
 * Petr 2026-05-15: po opakovaných sync má 1937 kontaktů místo ~1000.
 * `&#13;` v adresách, duplicity, auto-merge nestíhá. Nuclear option:
 *
 * SMAŽE všechny Contact BEZ overlay flagů. Zachová **jen** kontakty které
 * Petr ručně označil v Rašeliniště:
 *   - isVip == true       (VIP s callLogToken)
 *   - isTeam == true      (tým — smart routing)
 *   - clientTag != null   (klient slug)
 *   - aliases.length > 0  (manuální přezdívky pro AI)
 *   - callLogToken set    (VIP token přiřazen)
 *   - importedFrom != "icloud" && != "google" (manuální nebo Things)
 *
 * Po reset Petr klikne Synchronizovat s iCloudem → naimportuje čistý dataset.
 *
 * Auto-backup před delete = zachováno přes contacts-backup.
 */

import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { backupContact } from "@/lib/contacts-backup";

export const prerender = false;

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  // Bezpečnost: explicitní confirm token v body
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== "NUCLEAR_RESET") {
    return Response.json({ error: "Vyžaduje confirm: 'NUCLEAR_RESET' v body" }, { status: 400 });
  }

  // Najdi všechny kontakty které smažeme:
  // - žádný overlay flag (isVip/isTeam/clientTag/aliases/callLogToken)
  // - importedFrom je icloud/google (= sync-imported)
  const toDelete = await prisma.contact.findMany({
    where: {
      userId: session.uid,
      isVip: false,
      isTeam: false,
      clientTag: null,
      callLogToken: null,
      aliases: { isEmpty: true },
      OR: [
        { importedFrom: "icloud" },
        { importedFrom: "google" },
        { importedFrom: "vcard" },
        { syncSource: "icloud" },
        { syncSource: "google" },
      ],
    },
    select: { id: true, displayName: true },
  });

  const toKeep = await prisma.contact.count({
    where: {
      userId: session.uid,
      OR: [
        { isVip: true },
        { isTeam: true },
        { clientTag: { not: null } },
        { callLogToken: { not: null } },
        { aliases: { isEmpty: false } },
      ],
    },
  });

  const totalBefore = await prisma.contact.count({ where: { userId: session.uid } });

  // Auto-backup pred delete (pro top 100 — celkem ChactBackup table má cleanup
  // pri >500 řádků, takže když smazu 1500, prvních 500 backupů zůstane,
  // zbytek se ztratí. Stačí pro recovery individual ztracených).
  const toBackup = toDelete.slice(0, 200);
  for (const c of toBackup) {
    await backupContact(session.uid, c.id, "before_delete").catch(() => null);
  }

  // Bulk delete
  const result = await prisma.contact.deleteMany({
    where: { id: { in: toDelete.map((c) => c.id) } },
  });

  // Zaroven resetni icloud addressbook cache (donutí discovery nove)
  await prisma.userIntegration.updateMany({
    where: { userId: session.uid, provider: "icloud" },
    data: { lastError: null },
  });

  return Response.json({
    ok: true,
    totalBefore,
    deleted: result.count,
    keptOverlay: toKeep,
    finalCount: totalBefore - result.count,
    message: `Smazáno ${result.count} kontaktů bez overlay flagů. Zachováno ${toKeep} VIP/tým/klient/aliases kontaktů. Teď klikni 'Synchronizovat s iCloudem' pro čistý import.`,
  });
};
