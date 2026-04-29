import { prisma } from "./db";
import { transcribeAudio } from "./audio-transcribe";
import { getGemini, ANALYSIS_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";

/**
 * Audio → seznam úkolů (proposals).
 *
 * Pipeline:
 *  1) Stage 1: transcribe audio přes existující transcribeAudio() (two-stage,
 *     retries, AI Studio fallback) — vrátí čistý text přepisu.
 *  2) Stage 2: extractTaskProposals — Vertex Pro nad přepisem vyrobí
 *     strukturovaný JSON list úkolů (title/dueAt/tags/priority/notes/rawSnippet
 *     + assignedToContactName pokud Petr v hlasu řekl "Karel ať..." atd.)
 *  3) Uložit do TaskAudioBatch.proposalsJson, status=review.
 *  4) Petr v UI uvidí review screen, zaškrtne, klikne Vytvořit → vznikne N Task.
 *
 * NEsmí throw nahoru — všechny chyby se ukládají do batch.processingError.
 */

export interface TaskProposal {
  title: string;
  dueAt: string | null;        // ISO date nebo datetime
  dueIsTime: boolean;
  tags: string[];
  priority: "low" | "normal" | "high";
  notes: string | null;
  rawSnippet: string;
  // Délka jména/slug — Petr v review může vybrat z dropdownu kontaktů
  assignedToContactName: string | null;
}

export async function processTaskAudio(params: {
  batchId: string;
  audio: Buffer;
  mimeType: string;
}): Promise<void> {
  const batch = await prisma.taskAudioBatch.findUnique({ where: { id: params.batchId } });
  if (!batch) {
    console.error(`[process-task-audio] Batch ${params.batchId} nenalezen.`);
    return;
  }

  try {
    // Stage 1: přepis (znovupoužití existujícího transcribeAudio,
    // ale pro úkoly nepotřebujeme jeho analysis — jen transcript).
    const transcribeResult = await transcribeAudio({
      audio: params.audio,
      mimeType: params.mimeType,
      recordingType: "STANDARD", // úkolová salva je krátká
      projectContext: null,
    });

    const transcript = transcribeResult.transcript.trim();
    if (!transcript) {
      throw new Error("Přepis je prázdný — nahrávka byla zřejmě tichá.");
    }

    // Uložit transcript hned (kdyby Stage 2 selhal, máme aspoň přepis)
    await prisma.taskAudioBatch.update({
      where: { id: params.batchId },
      data: { rawTranscript: transcript },
    });

    // Stage 2: extrakce
    const proposals = await extractTaskProposals(transcript);

    await prisma.taskAudioBatch.update({
      where: { id: params.batchId },
      data: {
        proposalsJson: proposals as unknown as object,
        status: "review",
        processingError: null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[process-task-audio] ${params.batchId} failed:`, msg);
    await prisma.taskAudioBatch
      .update({
        where: { id: params.batchId },
        data: { status: "error", processingError: msg.slice(0, 1000) },
      })
      .catch(() => null);
  }
}

// ---------------------------------------------------------------------------
// Extrakce úkolů z přepisu — Vertex Gemini Pro, JSON output
// ---------------------------------------------------------------------------

export async function extractTaskProposals(transcript: string): Promise<TaskProposal[]> {
  // Načti seznam kontaktů — pomáhá AI rozpoznat "pro Karla" jako delegaci
  const contacts = await prisma.contact.findMany({
    select: { displayName: true, firstName: true },
    take: 200,
  });
  const contactNames = Array.from(new Set([
    ...contacts.map((c) => c.firstName).filter(Boolean) as string[],
    ...contacts.map((c) => c.displayName),
  ])).filter((n) => n.length >= 2);

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const dayCz = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"][today.getDay()];

  const prompt = `Jsi asistent Petra Periny pro správu úkolů. Petr ti dá přepis krátké mluvené salvy úkolů (typicky 30 s – 2 min). Tvým úkolem je vyrobit seznam jednotlivých úkolů ve strukturovaném JSON.

PRAVIDLA:
1. **Jeden záměr = jeden úkol.** "Zavolat Honzovi a poslat mu mail" → 2 úkoly. "Zavolat Honzovi kvůli střeše" → 1 úkol.
2. **title** = imperativ, krátký (max 80 znaků), česky, věcný. Začni slovesem ("Zavolat...", "Poslat...", "Koupit...", "Domluvit..."). Bez tečky na konci.
3. **dueAt** — parsuj relativní výrazy vůči referenceDate:
   - "dnes" → ${todayStr}
   - "zítra" → +1 den
   - "pozítří" → +2 dny
   - "v pondělí/úterý/..." → nejbližší budoucí výskyt
   - "do pátku" / "do konce týdne" → nejbližší pátek / neděle
   - "příští týden" → následující pondělí (orientační)
   - "v 15:00" / "ve tři odpoledne" → dueIsTime=true, čas dopočítej
   - "někdy" / "časem" / bez zmínky → dueAt = null
   - **Nehádej, pokud chybí zmínka.** Lepší null než falešný termín.
   - Format: "YYYY-MM-DD" pro datum, "YYYY-MM-DDTHH:MM:00" pro čas
4. **tags** — 1-4 tagy malými písmeny bez háčků. Použij jeden z: prace, dum, auto, zdravi, rodina, mortyk, blanka, nakup, telefonat, email, fakturace, urad. Volně přidej další.
5. **priority** — defaultně "normal". "high" jen pokud Petr explicitně řekl "důležité" / "urgent" / "rychle". "low" jen pokud "kdykoliv" / "není to spěch".
6. **notes** — pokud Petr řekl kontext / upřesnění, vlož tam. Jinak null. Max 200 znaků.
7. **rawSnippet** — doslovný úryvek z přepisu (5-15 slov), ze kterého úkol vznikl. Petrovi pomáhá v review.
8. **assignedToContactName** — pokud Petr řekl "Karel ať udělá X" / "pro Karla" / "Karlovi přiřadit", vyplň jméno z následujícího seznamu kontaktů (přesně jak je tam napsáno). Jinak null.
9. **Pořadí** = pořadí, v jakém Petr úkoly zmínil.

KONTAKTY (pro detekci delegace, vyber přesně podle jména):
${contactNames.length > 0 ? contactNames.slice(0, 50).join(", ") : "(žádné)"}

REFERENCE DATE: dnes je ${todayStr} (${dayCz})

PŘEPIS:
"""
${transcript}
"""

Vrať POUZE JSON tohoto tvaru, žádný markdown wrapper, žádný úvod:
{
  "tasks": [
    {
      "title": "...",
      "dueAt": "YYYY-MM-DD" | "YYYY-MM-DDTHH:MM:00" | null,
      "dueIsTime": false,
      "tags": ["..."],
      "priority": "normal",
      "notes": null,
      "rawSnippet": "...",
      "assignedToContactName": null
    }
  ]
}

Pokud přepis neobsahuje žádný úkol (Petr se přeřekl, nahrál ticho), vrať {"tasks": []}.`;

  const genai = getGemini();
  const response = await callTracked({
    module: "task-extract",
    modelName: ANALYSIS_MODEL,
    fn: () => genai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 4000,
        responseMimeType: "application/json",
      },
    }),
  });

  const raw = (response.text ?? "").trim();
  if (!raw) {
    throw new Error("Extrakce úkolů: Vertex vrátil prázdný výstup.");
  }

  let parsed: { tasks?: unknown[] };
  try {
    // Odstraní markdown wrapper kdyby ho Vertex přidal
    const cleaned = raw.startsWith("```")
      ? raw.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim()
      : raw;
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Extrakce úkolů: nelze parse JSON — ${e instanceof Error ? e.message : String(e)}. Prvních 200 znaků: ${raw.slice(0, 200)}`);
  }

  if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
    return [];
  }

  // Validace + sanitizace každého proposalu
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return parsed.tasks.map((t: any): TaskProposal => ({
    title: String(t.title ?? "").slice(0, 200) || "(bez názvu)",
    dueAt: typeof t.dueAt === "string" && t.dueAt.length > 0 ? t.dueAt : null,
    dueIsTime: Boolean(t.dueIsTime),
    tags: Array.isArray(t.tags) ? t.tags.filter((x: unknown) => typeof x === "string").slice(0, 8) : [],
    priority: ["low", "normal", "high"].includes(t.priority) ? t.priority : "normal",
    notes: typeof t.notes === "string" && t.notes.length > 0 ? t.notes.slice(0, 500) : null,
    rawSnippet: String(t.rawSnippet ?? "").slice(0, 300),
    assignedToContactName: typeof t.assignedToContactName === "string" && t.assignedToContactName.length > 0
      ? t.assignedToContactName
      : null,
  }));
}
