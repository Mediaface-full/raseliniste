import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { parseHaePayload } from "@/lib/health-parser";
import { importHealthRows } from "@/lib/health-import";

export const prerender = false;

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — roční HAE export má ~3 MB

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json({ error: "EXPECTED_MULTIPART" }, { status: 400 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "FILE_MISSING" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "FILE_TOO_LARGE", limit: MAX_BYTES, received: file.size },
      { status: 413 }
    );
  }

  let payload: unknown;
  try {
    const text = await file.text();
    payload = JSON.parse(text);
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = parseHaePayload(payload);
  if (parsed.metrics.length === 0 && parsed.ecgs.length === 0) {
    return Response.json({ error: "NO_DATA", parser: parsed.stats }, { status: 400 });
  }

  try {
    const stats = await importHealthRows(session.uid, parsed.metrics, parsed.ecgs);
    return Response.json({ ok: true, parser: parsed.stats, db: stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: "DB_ERROR", message: msg }, { status: 500 });
  }
};
