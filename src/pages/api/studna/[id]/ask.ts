import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { getGemini, ANALYSIS_MODEL } from "@/lib/gemini";
import { callTracked } from "@/lib/gemini-usage";

export const prerender = false;

/**
 * GET  /api/studna/:id/ask?q=... → odhad ceny dotazu
 * POST /api/studna/:id/ask body { q } → odpověď
 *
 * Gemini Pro nad VŠEMI transkripty + analýzami v projektu — Petr se zeptá
 * volnotextově ("kolik je tam zmínek o financích?", "kdo nejvíc mluvil o X?",
 * "shrnu pro Mortyka co Radek říkal o sci-fi knížce") a dostane strukturovanou
 * odpověď s odkazy na konkrétní záznamy.
 */

const Body = z.object({
  q: z.string().min(3).max(2000),
});

// Gemini 2.5 Pro pricing (USD per 1M tokens, May 2026):
// - input: $1.25 (do 200k context), $2.50 (200k+)
// - output: $10.00 (do 200k), $15.00 (200k+)
const PRICE_INPUT_PER_1M = 1.25;
const PRICE_OUTPUT_PER_1M = 10.0;
const PRICE_INPUT_LARGE_PER_1M = 2.5;
const LARGE_CONTEXT_THRESHOLD = 200_000;

const SYSTEM_PROMPT = `Jsi asistent Gideona pro analýzu projektových záznamů ze Studánky/Prskavky.
Máš k dispozici přepisy a strukturované rozbory všech audio záznamů v projektu.
Odpovídej věcně, strukturovaně, češtinu. Když se ptá na fakt — najdi v záznamech
konkrétní citaci s datem a autorem. Když se ptá obecně — udělej bullet-point shrnutí.
Pokud informaci nemáš, řekni že v záznamech není — nevymýšlej.

Citace formátuj jako: [DD.M. · autor] „doslova co řekl"
Když se odkazuješ na celý záznam, uveď datum + autora.`;

interface Recording {
  authorName: string;
  type: string;
  createdAt: Date;
  transcript: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analysis: any;
}

function buildContext(project: { name: string; description: string | null }, recordings: Recording[]): string {
  const lines: string[] = [];
  lines.push(`# Projekt: ${project.name}`);
  if (project.description) lines.push(`Kontext: ${project.description}`);
  lines.push("");
  lines.push(`Počet záznamů: ${recordings.length}`);
  lines.push("");

  for (let i = 0; i < recordings.length; i++) {
    const r = recordings[i];
    const date = r.createdAt.toLocaleString("cs-CZ", { timeZone: "Europe/Prague" });
    lines.push(`## [${i + 1}] ${r.type === "BRIEF" ? "📋 Brief" : "🎙 Standard"} · ${date} · ${r.authorName}`);
    lines.push("");
    if (r.analysis?.summary) {
      lines.push(`Souhrn: ${r.analysis.summary}`);
      lines.push("");
    }
    lines.push("Přepis:");
    lines.push(r.transcript ?? "");
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}

// Velmi hrubý odhad: 1 token ≈ 4 znaky pro češtinu (plus diakritika nahoru).
// Plus margin 1.2× a fixní overhead promptu (cca 1500 tokenů).
function estimateTokens(text: string): number {
  return Math.ceil((text.length / 4) * 1.2) + 1500;
}

function estimateCostUsd(inputTokens: number, expectedOutputTokens = 1500): { inputUsd: number; outputUsd: number; total: number } {
  const inputRate = inputTokens > LARGE_CONTEXT_THRESHOLD ? PRICE_INPUT_LARGE_PER_1M : PRICE_INPUT_PER_1M;
  const inputUsd = (inputTokens / 1_000_000) * inputRate;
  const outputUsd = (expectedOutputTokens / 1_000_000) * PRICE_OUTPUT_PER_1M;
  return { inputUsd, outputUsd, total: inputUsd + outputUsd };
}

async function loadProjectAndRecordings(userId: string, projectId: string) {
  const project = await prisma.projectBox.findFirst({
    where: { id: projectId, userId },
    select: { id: true, name: true, description: true },
  });
  if (!project) return null;

  const recordings = await prisma.projectRecording.findMany({
    where: { projectId, status: "processed" },
    orderBy: { createdAt: "asc" },
    select: { authorName: true, type: true, createdAt: true, transcript: true, analysis: true },
  });

  return { project, recordings };
}

// ---------------------------------------------------------------------------
// GET — estimate (Petr klikne "Spočítat cenu" před spuštěním)
// ---------------------------------------------------------------------------
export const GET: APIRoute = async ({ url, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const projectId = params.id;
  if (!projectId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const q = url.searchParams.get("q") ?? "";
  if (q.length < 3) return Response.json({ error: "Otázka je moc krátká." }, { status: 400 });

  const data = await loadProjectAndRecordings(session.uid, projectId);
  if (!data) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (data.recordings.length === 0) {
    return Response.json({ error: "Projekt nemá žádné zpracované záznamy." }, { status: 400 });
  }

  const context = buildContext(data.project, data.recordings);
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${context}\n\nOTÁZKA: ${q}\n\nODPOVĚĎ:`;
  const inputTokens = estimateTokens(fullPrompt);
  const cost = estimateCostUsd(inputTokens);

  return Response.json({
    estimate: {
      recordings: data.recordings.length,
      inputTokens,
      contextChars: context.length,
      cost: {
        inputUsd: cost.inputUsd,
        expectedOutputUsd: cost.outputUsd,
        totalUsd: cost.total,
      },
      humanReadable: cost.total < 0.01
        ? `méně než $0.01`
        : `~$${cost.total.toFixed(3)} (${(cost.total * 24).toFixed(2)} Kč)`,
    },
  });
};

// ---------------------------------------------------------------------------
// POST — provedení dotazu
// ---------------------------------------------------------------------------
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const projectId = params.id;
  if (!projectId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const data = await loadProjectAndRecordings(session.uid, projectId);
  if (!data) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (data.recordings.length === 0) {
    return Response.json({ error: "Projekt nemá žádné zpracované záznamy." }, { status: 400 });
  }

  const context = buildContext(data.project, data.recordings);
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${context}\n\nOTÁZKA: ${body.q}\n\nODPOVĚĎ:`;

  const ai = getGemini();
  try {
    const response = await callTracked({
      module: "studna-ask",
      modelName: ANALYSIS_MODEL,
      fn: () => ai.models.generateContent({
        model: ANALYSIS_MODEL,
        contents: fullPrompt,
        config: { temperature: 0.2, maxOutputTokens: 4000 },
      }),
    });

    const answer = (response.text ?? "").trim();
    if (!answer) {
      return Response.json({ error: "AI vrátila prázdnou odpověď." }, { status: 500 });
    }

    return Response.json({
      answer,
      recordings: data.recordings.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
};
