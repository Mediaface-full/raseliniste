/**
 * POST /api/contacts/:id/delete-everywhere
 *
 * Petr 2026-05-16: smazat kontakt z VŠECH zdrojů (DB, iCloud CardDAV,
 * Google People API).
 *
 * Flow:
 *  1. Auto-backup před smazáním (contacts-backup)
 *  2. Best-effort DELETE z iCloudu pokud má icloudHref
 *  3. Best-effort DELETE z Google pokud má googleResourceName
 *  4. Hard DELETE z DB (cascade phones/emails)
 *
 * Vrátí stats { deletedFromIcloud, deletedFromGoogle, icloudError, googleError }.
 */

import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { backupContact } from "@/lib/contacts-backup";

export const prerender = false;

export const POST: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const contact = await prisma.contact.findFirst({
    where: { id, userId: session.uid },
    select: { id: true, displayName: true, icloudHref: true, icloudEtag: true, googleResourceName: true },
  });
  if (!contact) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // 1) Backup
  await backupContact(session.uid, contact.id, "before_delete").catch(() => null);

  let deletedFromIcloud = false;
  let icloudError: string | null = null;
  let deletedFromGoogle = false;
  let googleError: string | null = null;

  // 2) iCloud DELETE (pokud má href)
  if (contact.icloudHref) {
    try {
      const { getIcloudCredentials } = await import("@/lib/icloud-contacts");
      const creds = await getIcloudCredentials(session.uid);
      if (creds) {
        const { deleteVCard } = await import("@/lib/carddav");
        const url = contact.icloudHref.startsWith("http")
          ? contact.icloudHref
          : `https://contacts.icloud.com${contact.icloudHref}`;
        await deleteVCard(url, creds, contact.icloudEtag);
        deletedFromIcloud = true;
      } else {
        icloudError = "credentials missing";
      }
    } catch (e) {
      icloudError = e instanceof Error ? e.message.slice(0, 100) : String(e).slice(0, 100);
    }
  }

  // 3) Google DELETE (pokud má resourceName)
  if (contact.googleResourceName) {
    try {
      const { google } = await import("googleapis");
      const { getAuthorizedClient } = await import("@/lib/google-oauth");
      const oauth = await getAuthorizedClient(session.uid);
      const people = google.people({ version: "v1", auth: oauth });
      await people.people.deleteContact({ resourceName: contact.googleResourceName });
      deletedFromGoogle = true;
    } catch (e) {
      googleError = e instanceof Error ? e.message.slice(0, 100) : String(e).slice(0, 100);
    }
  }

  // 4) DB DELETE
  await prisma.contact.delete({ where: { id: contact.id } });

  return Response.json({
    ok: true,
    deletedFromIcloud,
    deletedFromGoogle,
    icloudError,
    googleError,
  });
};
