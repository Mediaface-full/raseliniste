/**
 * Laboratorní výsledky z PDF (Petr 2026-07-16).
 *
 * Pipeline: upload PDF → HealthLabReport (status=processing) → fire-and-forget
 * Gemini flash extrakce (PDF inline, JSON out) → HealthLabResult řádky →
 * status=ready. UI polluje /api/health/labs à 4 s (žádný spinner —
 * feedback_no_processing_spinner).
 *
 * Module-level Set drží referenci na běžící promise (lekce Studna —
 * fire-and-forget Promise jinak sebere GC).
 */

import { z } from "zod";
import { prisma } from "./db";
import { getGemini, FAST_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";
import { readUpload } from "./uploads";

const runningJobs = new Set<Promise<void>>();

const resultSchema = z.object({
  analyte: z.string().min(1),
  value: z.number().nullable().optional(),
  value_text: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  ref_low: z.number().nullable().optional(),
  ref_high: z.number().nullable().optional(),
  ref_text: z.string().nullable().optional(),
  flag: z.enum(["H", "L"]).nullable().optional(),
});

const extractionSchema = z.object({
  sampled_at: z.string().nullable().optional(), // "YYYY-MM-DD"
  lab_name: z.string().nullable().optional(),
  results: z.array(resultSchema),
});

const PROMPT = `Jsi extraktor laboratorních výsledků z českých (i slovenských) lékařských PDF zpráv.

Z přiloženého PDF vytáhni VŠECHNY laboratorní hodnoty (krev, moč, biochemie,
krevní obraz, hormony, vitamíny, lipidy…). Vrať POUZE validní JSON:

{
  "sampled_at": "YYYY-MM-DD",   // datum ODBĚRU (ne datum tisku zprávy); null když nelze určit
  "lab_name": "…",              // název laboratoře/zařízení; null když chybí
  "results": [
    {
      "analyte": "Glukóza",     // český název analytu BEZ prefixů typu "S-", "P-", "B-" (ty urči jen materiál)
      "value": 5.2,             // číselná hodnota; null pokud výsledek není číslo
      "value_text": null,       // textový výsledek ("negativní", "nezjištěno") pokud value je null
      "unit": "mmol/l",         // jednotka jak je v PDF; null když chybí
      "ref_low": 3.9,           // dolní mez reference jako číslo; null když chybí
      "ref_high": 5.6,          // horní mez reference jako číslo; null když chybí
      "ref_text": "3,9–5,6",    // referenční rozmezí přesně jak stojí v PDF
      "flag": null              // "H" = nad normou, "L" = pod normou, null = v normě/nelze určit
    }
  ]
}

Pravidla:
- Desetinné čárky převeď na tečky (5,2 → 5.2).
- flag odvoď primárně ze značky v PDF (*, H, L, šipky); když značka chybí,
  odvoď z hodnoty vs. reference; když nejde, null.
- Nevymýšlej hodnoty které v PDF nejsou. Nepřidávej komentáře mimo JSON.`;

/** Normalizace názvu analytu na klíč řady: bez diakritiky, lowercase, pomlčky. */
export function analyteKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Odpověď AI není validní JSON.");
  }
}

async function processInner(reportId: string): Promise<void> {
  const report = await prisma.healthLabReport.findUnique({ where: { id: reportId } });
  if (!report) return;

  try {
    const pdf = await readUpload(report.pdfPath);
    const ai = getGemini();
    const response = await callTracked({
      module: "health-labs",
      modelName: FAST_MODEL,
      fn: () => ai.models.generateContent({
        model: FAST_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "application/pdf", data: pdf.toString("base64") } },
              { text: PROMPT },
            ],
          },
        ],
        config: { temperature: 0, maxOutputTokens: 16000, responseMimeType: "application/json" },
      }),
    });

    const parsed = extractionSchema.parse(extractJson(response.text ?? ""));
    if (parsed.results.length === 0) {
      throw new Error("V PDF se nepodařilo najít žádné laboratorní hodnoty.");
    }

    const sampledAt = parsed.sampled_at ? new Date(`${parsed.sampled_at}T00:00:00`) : report.createdAt;
    if (Number.isNaN(sampledAt.getTime())) {
      throw new Error(`AI vrátila nečitelné datum odběru: ${parsed.sampled_at}`);
    }

    await prisma.$transaction([
      prisma.healthLabResult.deleteMany({ where: { reportId } }),
      prisma.healthLabResult.createMany({
        data: parsed.results.map((r) => ({
          userId: report.userId,
          reportId,
          analyte: r.analyte.trim(),
          analyteKey: analyteKey(r.analyte),
          value: r.value ?? null,
          valueText: r.value_text ?? null,
          unit: r.unit ?? null,
          refLow: r.ref_low ?? null,
          refHigh: r.ref_high ?? null,
          refText: r.ref_text ?? null,
          flag: r.flag ?? null,
          sampledAt,
        })),
      }),
      prisma.healthLabReport.update({
        where: { id: reportId },
        data: {
          status: "ready",
          processingError: null,
          sampledAt,
          labName: parsed.lab_name?.trim() || null,
          model: FAST_MODEL,
        },
      }),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[health-labs] extrakce ${reportId} selhala:`, msg);
    await prisma.healthLabReport.update({
      where: { id: reportId },
      data: { status: "error", processingError: msg.slice(0, 2000) },
    }).catch(() => {});
  }
}

/** Fire-and-forget zpracování reportu (drženo v module Setu proti GC). */
export function processLabReportInBackground(reportId: string): void {
  const job = processInner(reportId).finally(() => { runningJobs.delete(job); });
  runningJobs.add(job);
}

/**
 * Data pro AI analýzu zdraví: poslední + předposlední hodnota každého
 * analytu (řazeno podle odběru) — kompaktní textový blok do promptu.
 */
export async function labSummaryForAnalysis(userId: string): Promise<string | null> {
  const results = await prisma.healthLabResult.findMany({
    where: { userId, value: { not: null } },
    orderBy: { sampledAt: "desc" },
    take: 400,
    select: { analyte: true, analyteKey: true, value: true, unit: true, refLow: true, refHigh: true, flag: true, sampledAt: true },
  });
  if (results.length === 0) return null;

  const byKey = new Map<string, typeof results>();
  for (const r of results) {
    const arr = byKey.get(r.analyteKey) ?? [];
    if (arr.length < 3) arr.push(r);
    byKey.set(r.analyteKey, arr);
  }

  const lines: string[] = [];
  for (const arr of byKey.values()) {
    const latest = arr[0];
    const fmtD = (d: Date) => d.toISOString().slice(0, 10);
    const ref = latest.refLow !== null || latest.refHigh !== null
      ? ` (ref ${latest.refLow ?? "?"}–${latest.refHigh ?? "?"})` : "";
    const hist = arr.slice(1).map((h) => `${h.value} @${fmtD(h.sampledAt)}`).join(", ");
    lines.push(
      `- ${latest.analyte}: ${latest.value} ${latest.unit ?? ""}${ref}${latest.flag ? ` [${latest.flag}]` : ""} @${fmtD(latest.sampledAt)}${hist ? ` | dříve: ${hist}` : ""}`,
    );
  }
  return lines.join("\n");
}
