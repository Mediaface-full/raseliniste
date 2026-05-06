import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { transcribeAudio } from "@/lib/audio-transcribe";
import { getGemini, ANALYSIS_MODEL } from "@/lib/gemini";
import { callTracked } from "@/lib/gemini-usage";
import { saveUpload } from "@/lib/uploads";

export const prerender = false;

/**
 * POST /api/bwmys/[id]/entry-audio
 * Multipart form: audio (Blob), durationSec (string)
 *
 * Pipeline:
 *   1. Stage 1: transcribe audio (existující transcribeAudio, cleanupFillers=true)
 *   2. Stage 2: extrakce strukturovaného zápisu — nálada, typ, úhel, obsah
 *      (vlastní prompt — věcný tón, NE terapeutický)
 *   3. Vytvoří DecisionEntry s extrahovanými metadaty
 *   4. Vrátí entry pro frontend (může editovat před uložením? V MVP rovnou ulož.)
 *
 * Petr může pak v Detail UI editovat metadata (nálada, typ, úhel) ručně.
 */

interface ExtractedEntry {
  nalada: number;
  typVstupu: "novy_fakt_zvenci" | "nova_uvaha" | "napadlo_me" | "reakce_na_udalost";
  uhelPohledu: "fakta" | "emoce" | "kritika" | "prinosy" | "alternativy" | "meta" | "nevybrano";
  obsah: string;
}

async function extractEntryFromTranscript(transcript: string, decisionContext: { otazka: string; varianty: string[] }): Promise<ExtractedEntry> {
  const prompt = `Jsi asistent pro strukturované rozhodování. Uživatel právě nadiktoval zápis k tomuto rozhodnutí:

OTÁZKA: ${decisionContext.otazka}
VARIANTY: ${decisionContext.varianty.join(" | ")}

PŘEPIS NAHRÁVKY:
"""
${transcript}
"""

Vyextrahuj strukturovaný zápis. Tón výstupu věcný, NE terapeutický.

PRAVIDLA:
- nalada (1-5): odhadni z tónu/jazyka přepisu. 1=nejhorší, 5=nejlepší. Pokud je tón neutrální, dej 3.
- typVstupu: jeden z:
  - "novy_fakt_zvenci" — uživatel se dozvěděl něco nového (informace, číslo, událost)
  - "nova_uvaha" — vlastní reflexe, analýza, přemýšlení nahlas
  - "napadlo_me" — kreativní záblesk, nová varianta, nápad
  - "reakce_na_udalost" — reakce na konkrétní událost která se stala
- uhelPohledu (Six Hats): jeden z:
  - "fakta" (bílý) — věcné informace
  - "emoce" (červený) — pocity, intuice
  - "kritika" (černý) — rizika, problémy
  - "prinosy" (žlutý) — výhody
  - "alternativy" (zelený) — kreativní nápady
  - "meta" (modrý) — pozorování o procesu
  - "nevybrano" — nelze rozhodnout
- obsah: vyčištěný text přepisu (zachovej původní obsah, jen opravit drobné chyby přepisu, vynech "ehm/eee/no/jakože"). Max 2000 znaků.

Vrať POUZE JSON tohoto tvaru:
{
  "nalada": 3,
  "typVstupu": "nova_uvaha",
  "uhelPohledu": "kritika",
  "obsah": "..."
}`;

  const ai = getGemini();
  const response = await callTracked({
    module: "bwmys-audio-extract",
    modelName: ANALYSIS_MODEL,
    fn: () => ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: { temperature: 0.2, maxOutputTokens: 3000, responseMimeType: "application/json" },
    }),
  });

  const raw = (response.text ?? "").trim();
  let parsed: ExtractedEntry;
  try {
    parsed = JSON.parse(raw) as ExtractedEntry;
  } catch {
    // Repair pass — Gemini občas vyčerpá maxOutputTokens uprostřed stringu.
    let s = raw.trim();
    if (s.startsWith("```")) {
      const m = s.match(/```(?:json)?\s*([\s\S]+?)```/);
      if (m) s = m[1].trim();
    }
    const fb = s.indexOf("{"), lb = s.lastIndexOf("}");
    if (fb >= 0 && lb > fb) s = s.slice(fb, lb + 1);
    try {
      parsed = JSON.parse(s) as ExtractedEntry;
    } catch {
      // Fallback — vrať defaults s celým transkriptem v obsahu
      parsed = {
        nalada: 3,
        typVstupu: "nova_uvaha",
        uhelPohledu: "nevybrano",
        obsah: transcript.slice(0, 5000),
      };
    }
  }

  // Sanitizace + defaults
  const allowedTyp = ["novy_fakt_zvenci", "nova_uvaha", "napadlo_me", "reakce_na_udalost"];
  const allowedUhel = ["fakta", "emoce", "kritika", "prinosy", "alternativy", "meta", "nevybrano"];

  return {
    nalada: Math.max(1, Math.min(5, Math.round(parsed.nalada ?? 3))),
    typVstupu: (allowedTyp.includes(parsed.typVstupu) ? parsed.typVstupu : "nova_uvaha") as ExtractedEntry["typVstupu"],
    uhelPohledu: (allowedUhel.includes(parsed.uhelPohledu) ? parsed.uhelPohledu : "nevybrano") as ExtractedEntry["uhelPohledu"],
    obsah: String(parsed.obsah ?? "").slice(0, 5000) || transcript.slice(0, 5000),
  };
}

export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const decisionId = params.id;
  if (!decisionId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const decision = await prisma.decision.findFirst({
    where: { id: decisionId, userId: session.uid },
  });
  if (!decision) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (decision.status !== "aktivni") {
    return Response.json({ error: "Rozhodnutí už není aktivní." }, { status: 400 });
  }

  const fd = await request.formData();
  const audioFile = fd.get("audio");
  if (!(audioFile instanceof File)) {
    return Response.json({ error: "MISSING_AUDIO" }, { status: 400 });
  }

  const audioBuf = Buffer.from(await audioFile.arrayBuffer());
  const mime = audioFile.type || "audio/webm";

  // Hned ulož audio + vytvoř entry s status="processing".
  // Petr dostane odpověď okamžitě — AI Stage 1+2 běží na pozadí.
  let saved;
  try {
    saved = await saveUpload(`bwmys/${decisionId}`, audioBuf, mime);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Ukládání selhalo." }, { status: 500 });
  }

  const entry = await prisma.decisionEntry.create({
    data: {
      decisionId,
      nalada: 3,                  // placeholder, AI updatuje
      typVstupu: "nova_uvaha",   // placeholder
      uhelPohledu: "nevybrano",  // placeholder
      obsah: "[Audio se zpracovává…]",
      audioPath: saved.relativePath,
      audioMime: mime,
      audioBytes: audioBuf.byteLength,
      status: "processing",
    },
  });

  // Fire-and-forget — drž referenci přes module-level Set ať Promise neumře GC.
  void runAiPipeline(entry.id, audioBuf, mime, {
    nazev: decision.nazev,
    otazka: decision.otazka,
    varianty: decision.varianty as string[],
  });

  return Response.json({ entry, processing: true });
};

// Module-level Set drží reference na probíhající Promise (Astro/Node fire-and-forget
// jinak nespolehlivé — GC může Promise sebrat).
const inFlight = new Set<Promise<void>>();

async function runAiPipeline(
  entryId: string,
  audio: Buffer,
  mime: string,
  ctx: { nazev: string; otazka: string; varianty: string[] },
): Promise<void> {
  const p = (async () => {
    try {
      const transcribeResult = await transcribeAudio({
        audio,
        mimeType: mime,
        recordingType: "STANDARD",
        projectContext: `Rozhodnutí "${ctx.nazev}": ${ctx.otazka}`,
        cleanupFillers: true,
      });

      const transcript = transcribeResult.transcript.trim();
      if (!transcript) {
        await prisma.decisionEntry.update({
          where: { id: entryId },
          data: { status: "error", processingError: "Přepis je prázdný — nahrávka byla zřejmě tichá." },
        });
        return;
      }

      const extracted = await extractEntryFromTranscript(transcript, {
        otazka: ctx.otazka,
        varianty: ctx.varianty,
      });

      await prisma.decisionEntry.update({
        where: { id: entryId },
        data: {
          nalada: extracted.nalada,
          typVstupu: extracted.typVstupu,
          uhelPohledu: extracted.uhelPohledu,
          obsah: extracted.obsah,
          status: "ready",
          processingError: null,
        },
      });
      console.log(`[bwmys entry-audio] ${entryId} processed in background`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[bwmys entry-audio] ${entryId} background failed:`, msg);
      try {
        await prisma.decisionEntry.update({
          where: { id: entryId },
          data: { status: "error", processingError: msg.slice(0, 1000) },
        });
      } catch {}
    } finally {
      inFlight.delete(p);
    }
  })();
  inFlight.add(p);
  return p;
}
