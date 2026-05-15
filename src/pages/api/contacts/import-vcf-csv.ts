/**
 * POST /api/contacts/import-vcf-csv (multipart)
 *
 * Petr 2026-05-15 (kontakty_brief.md 5.8 E). Nový endpoint vedle legacy
 * /api/contacts/import (Things). Tento bere VCF/CSV soubor s drag-and-drop
 * a podporuje preview+apply flow s collision detection.
 *
 * Body (multipart):
 *   - file: VCF nebo CSV (max 10 MB)
 *   - overwrite: "1" = update collisions, "0" = skip
 *   - action: "preview" nebo "apply"
 *
 * Detekce VCF vs CSV podle obsahu (BEGIN:VCARD → VCF).
 */

import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { importVcf, importCsv } from "@/lib/contacts-import";

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024;

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Chybí soubor." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: `Max ${MAX_BYTES / 1024 / 1024} MB.` }, { status: 413 });

  const overwrite = form.get("overwrite") === "1";
  const action = (form.get("action") ?? "preview") as "preview" | "apply";

  const text = await file.text();
  const isVcf = /BEGIN:VCARD/i.test(text);

  const result = isVcf
    ? await importVcf(session.uid, text, { overwrite, action })
    : await importCsv(session.uid, text, { overwrite, action });

  return Response.json({ ok: true, format: isVcf ? "vcf" : "csv", ...result });
};
