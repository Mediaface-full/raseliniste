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
  const parsed = JSON.parse(raw) as ExtractedEntry;

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

  try {
    const audioBuf = Buffer.from(await audioFile.arrayBuffer());
    const mime = audioFile.type || "audio/webm";

    // Stage 1: přepis
    const transcribeResult = await transcribeAudio({
      audio: audioBuf,
      mimeType: mime,
      recordingType: "STANDARD",
      projectContext: `Rozhodnutí "${decision.nazev}": ${decision.otazka}`,
      cleanupFillers: true,
    });

    const transcript = transcribeResult.transcript.trim();
    if (!transcript) {
      return Response.json({ error: "Přepis je prázdný — nahrávka byla zřejmě tichá." }, { status: 400 });
    }

    // Stage 2: extrakce metadat
    const extracted = await extractEntryFromTranscript(transcript, {
      otazka: decision.otazka,
      varianty: decision.varianty as string[],
    });

    // Uložit audio (pro audit) + entry
    const saved = await saveUpload(`bwmys/${decisionId}`, audioBuf, mime);

    const entry = await prisma.decisionEntry.create({
      data: {
        decisionId,
        nalada: extracted.nalada,
        typVstupu: extracted.typVstupu,
        uhelPohledu: extracted.uhelPohledu,
        obsah: extracted.obsah,
        audioPath: saved.relativePath,
        audioMime: mime,
        audioBytes: audioBuf.byteLength,
      },
    });

    return Response.json({ entry, transcript });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[bwmys entry-audio]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
};
