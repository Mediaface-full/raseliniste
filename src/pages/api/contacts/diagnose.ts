/**
 * GET /api/contacts/diagnose
 *
 * Petr 2026-05-15: dohlédnutí kde se berou kontakty. Vrátí breakdown
 * podle syncSource / importedFrom + 20 nejnovějších + cluster stats.
 */

import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { findDuplicateClusters } from "@/lib/contacts-duplicates";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const userId = session.uid;
  const total = await prisma.contact.count({ where: { userId } });

  // Breakdown podle syncSource
  const bySyncSource = await prisma.contact.groupBy({
    by: ["syncSource"],
    where: { userId },
    _count: true,
  });

  const byImportedFrom = await prisma.contact.groupBy({
    by: ["importedFrom"],
    where: { userId },
    _count: true,
  });

  // 20 nejnovějších
  const recent = await prisma.contact.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true, displayName: true, firstName: true, lastName: true,
      syncSource: true, importedFrom: true, icloudUid: true, googleResourceName: true,
      createdAt: true, isVip: true, clientTag: true,
    },
  });

  // Duplicity clusters (jen stats)
  const clusters = await findDuplicateClusters(userId);
  const totalDuplicates = clusters.reduce((sum, c) => sum + c.contacts.length, 0);
  const wouldRemove = clusters.reduce((sum, c) => sum + (c.contacts.length - 1), 0);

  // Per overlay flag
  const overlay = {
    isVip: await prisma.contact.count({ where: { userId, isVip: true } }),
    isTeam: await prisma.contact.count({ where: { userId, isTeam: true } }),
    clientTag: await prisma.contact.count({ where: { userId, clientTag: { not: null } } }),
    aliases: await prisma.contact.count({ where: { userId, aliases: { isEmpty: false } } }),
    callLogToken: await prisma.contact.count({ where: { userId, callLogToken: { not: null } } }),
    withIcloudUid: await prisma.contact.count({ where: { userId, icloudUid: { not: null } } }),
    withGoogleResourceName: await prisma.contact.count({ where: { userId, googleResourceName: { not: null } } }),
    withoutAny: await prisma.contact.count({
      where: {
        userId,
        icloudUid: null,
        googleResourceName: null,
        isVip: false,
        isTeam: false,
        clientTag: null,
        callLogToken: null,
        aliases: { isEmpty: true },
      },
    }),
  };

  return Response.json({
    ok: true,
    total,
    bySyncSource: bySyncSource.map((b) => ({ syncSource: b.syncSource ?? "(null)", count: b._count })),
    byImportedFrom: byImportedFrom.map((b) => ({ importedFrom: b.importedFrom ?? "(null)", count: b._count })),
    overlay,
    duplicates: {
      clusters: clusters.length,
      totalContactsInClusters: totalDuplicates,
      wouldRemoveByMerge: wouldRemove,
      top5Examples: clusters.slice(0, 5).map((c) => ({
        contactCount: c.contacts.length,
        reasons: c.reason,
        contacts: c.contacts.map((x) => ({
          id: x.id,
          displayName: x.displayName,
          phones: x.phones.slice(0, 2),
          emails: x.emails.slice(0, 2),
          icloudUid: x.icloudUid?.slice(0, 8) ?? null,
          syncSource: x.syncSource,
        })),
      })),
    },
    recent20: recent.map((c) => ({
      id: c.id,
      name: c.displayName || `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(),
      syncSource: c.syncSource ?? "(null)",
      importedFrom: c.importedFrom ?? "(null)",
      hasIcloudUid: Boolean(c.icloudUid),
      hasGoogleResourceName: Boolean(c.googleResourceName),
      isVip: c.isVip,
      clientTag: c.clientTag,
      createdAt: c.createdAt.toISOString(),
    })),
  });
};
