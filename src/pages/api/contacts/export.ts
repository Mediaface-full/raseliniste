/**
 * GET /api/contacts/export?format=vcf|csv&scope=all|company:X|group:Y&firemni=1
 *
 * Petr 2026-05-15 (kontakty_brief.md 5.9).
 */

import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { generateExport, type ExportFormat } from "@/lib/contacts-export";

export const prerender = false;

export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const format = (url.searchParams.get("format") ?? "vcf") as ExportFormat;
  if (format !== "vcf" && format !== "csv") {
    return Response.json({ error: "format musí být vcf nebo csv" }, { status: 400 });
  }
  const scopeStr = url.searchParams.get("scope") ?? "all";
  const firemniMin = url.searchParams.get("firemni") === "1";

  let scope: { company: string } | { group: string } | "all";
  if (scopeStr.startsWith("company:")) {
    scope = { company: scopeStr.slice("company:".length) };
  } else if (scopeStr.startsWith("group:")) {
    scope = { group: scopeStr.slice("group:".length) };
  } else {
    scope = "all";
  }

  const { content, filename, contentType } = await generateExport(session.uid, { format, scope, firemniMin });

  return new Response(content, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
};
