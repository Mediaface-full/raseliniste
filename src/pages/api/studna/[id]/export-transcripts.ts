import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/studna/:id/export-transcripts
 *
 * Stáhne MD soubor se VŠEMI přepisy projektu (STANDARD i BRIEF) chronologicky,
 * BEZ AI analýzy. Petr chce pracovat s čistým textem dál (mailem, do dokumentu,
 * jiné AI atd.).
 */
function fmtDuration(sec: number | null): string {
  if (!sec || sec < 0) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} s`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s} s`;
}

function safeFilename(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diakritika pryč
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "studna-export";
}

export const GET: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return new Response("Unauthorized", { status: 401 });
  const projectId = params.id;
  if (!projectId) return new Response("Bad request", { status: 400 });

  const project = await prisma.projectBox.findFirst({
    where: { id: projectId, userId: session.uid },
    select: { id: true, name: true, description: true, isPrivate: true },
  });
  if (!project) return new Response("Not found", { status: 404 });

  const recordings = await prisma.projectRecording.findMany({
    where: { projectId, status: "processed" },
    orderBy: { createdAt: "asc" },
    select: {
      authorName: true,
      isOwner: true,
      type: true,
      audioDurationSec: true,
      transcript: true,
      guestNote: true,
      createdAt: true,
    },
  });

  const lines: string[] = [];
  const moduleLabel = project.isPrivate ? "Prskavka" : "Studánka";

  lines.push(`# ${moduleLabel} — ${project.name}`);
  lines.push("");
  lines.push(`Export přepisů bez AI analýzy · ${new Date().toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}`);
  lines.push("");

  if (project.description) {
    lines.push("## Kontext projektu");
    lines.push("");
    lines.push(project.description);
    lines.push("");
  }

  const briefs = recordings.filter((r) => r.type === "BRIEF").length;
  const standards = recordings.length - briefs;
  lines.push(`**Záznamů:** ${recordings.length} (${standards} standard · ${briefs} brief)`);
  lines.push("");
  lines.push("---");
  lines.push("");

  if (recordings.length === 0) {
    lines.push("_Projekt zatím neobsahuje žádné zpracované záznamy._");
  } else {
    for (const r of recordings) {
      const type = r.type === "BRIEF" ? "📋 Brief" : "Standard";
      const dur = fmtDuration(r.audioDurationSec);
      const date = r.createdAt.toLocaleString("cs-CZ", {
        timeZone: "Europe/Prague",
        day: "numeric", month: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
      const author = r.isOwner ? `${r.authorName} (vlastník)` : r.authorName;

      lines.push(`## ${type} · ${date}`);
      lines.push(`*${author}${dur ? ` · ${dur}` : ""}*`);
      lines.push("");

      if (r.guestNote && r.guestNote.trim()) {
        lines.push(`> **Textový vzkaz hosta:**`);
        lines.push(`> ${r.guestNote.trim().split("\n").join("\n> ")}`);
        lines.push("");
      }

      const t = (r.transcript ?? "").trim();
      if (t) {
        lines.push(t);
      } else {
        lines.push("_Přepis je prázdný._");
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  const md = lines.join("\n");
  const today = new Date().toISOString().slice(0, 10);
  const filename = `${safeFilename(project.name)}-prepisy-${today}.md`;

  return new Response(md, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
};
