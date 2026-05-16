import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { resolveUpload, uploadExists } from "@/lib/uploads";

export const prerender = false;

/**
 * GET /api/studna/recordings/:id/audio
 *   Streamne audio soubor pro owner (přehrávač v detailu).
 *   Auth: session + ownership přes project.userId.
 */
export const GET: APIRoute = async ({ cookies, params, url }) => {
  const session = await readSession(cookies);
  if (!session) return new Response("Unauthorized", { status: 401 });
  const id = params.id;
  if (!id) return new Response("Bad request", { status: 400 });

  const recording = await prisma.projectRecording.findFirst({
    where: { id, project: { userId: session.uid } },
    select: { audioPath: true, audioMime: true, uploadedFilename: true, createdAt: true },
  });
  if (!recording) return new Response("Not found", { status: 404 });
  if (!recording.audioPath || !(await uploadExists(recording.audioPath))) {
    return new Response("Audio bylo automaticky smazáno (>14 dní). Připnutí zachovává soubor permanentně.", {
      status: 404,
    });
  }

  const buf = await fs.readFile(resolveUpload(recording.audioPath));
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

  const headers: Record<string, string> = {
    "Content-Type": recording.audioMime ?? "audio/webm",
    "Content-Length": String(buf.byteLength),
    "Cache-Control": "private, max-age=3600",
  };

  if (url.searchParams.get("download") === "1") {
    const ext = (recording.audioMime?.split("/")[1] ?? "webm").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "webm";
    const stamp = recording.createdAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = recording.uploadedFilename ?? `studna-${stamp}.${ext}`;
    const safe = filename.replace(/[^a-z0-9._-]/gi, "_");
    headers["Content-Disposition"] = `attachment; filename="${safe}"`;
  }

  return new Response(bytes, { status: 200, headers });
};
