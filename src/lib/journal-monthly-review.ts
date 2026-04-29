import { prisma } from "./db";
import { getGemini, ANALYSIS_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";
import { getPrompt } from "./ai-prompts";

/**
 * Měsíční rekapitulace deníkových zápisů.
 *
 * Vstup do AI: jen METADATA hlavičky a POZNÁMKY EDITORA z bodyMarkdown.
 * Tělo zápisů NEPOSÍLÁME — chrání citlivý obsah, šetří tokeny, dává AI
 * jen strukturovaná data k vzorcové analýze (přesně jak Gideon chce).
 *
 * Výstup: plain markdown s reflexivním přehledem (vzorce, lidé, vývoj,
 * nedořešené nitky, kreativní výstupy).
 */

export interface MonthlyReview {
  yearMonth: string;             // "2026-04"
  entryCount: number;
  reviewMarkdown: string;
  generatedAt: Date;
  // Souhrnná metadata (extrahovaná napříč zápisy):
  topTags: Array<{ tag: string; count: number }>;
  topPeople: Array<{ person: string; count: number }>;
  moodHistogram: Record<string, number>;
}

/**
 * Vyextrahuje METADATA hlavičku + POZNÁMKY EDITORA z plný bodyMarkdown
 * jednoho zápisu. Tělo (text uprostřed) ignoruje.
 */
function extractMetaSlice(bodyMarkdown: string): string {
  const headerMatch = bodyMarkdown.match(/^---\n([\s\S]*?)\n---/);
  const editorMatch = bodyMarkdown.match(/POZNÁMKY EDITORA[\s\S]*?(?=\n---|\n*$)/i);

  const parts: string[] = [];
  if (headerMatch) parts.push(`HLAVIČKA:\n${headerMatch[1].trim()}`);
  if (editorMatch) parts.push(`POZNÁMKY EDITORA:\n${editorMatch[0].trim()}`);

  // Fallback: pokud Gideon zápis psal manuálně bez hlavičky, vezmi prvních 500 znaků
  if (parts.length === 0) {
    parts.push(`(bez metadat) ${bodyMarkdown.slice(0, 500)}`);
  }
  return parts.join("\n\n");
}

export async function generateMonthlyReview(params: {
  userId: string;
  year: number;
  month: number; // 1-12
}): Promise<MonthlyReview> {
  const monthStart = new Date(params.year, params.month - 1, 1);
  const monthEnd = new Date(params.year, params.month, 0);
  monthEnd.setHours(23, 59, 59, 999);

  const entries = await prisma.journalEntry.findMany({
    where: {
      userId: params.userId,
      date: { gte: monthStart, lte: monthEnd },
      status: "ready",
    },
    orderBy: { date: "asc" },
    select: {
      date: true, title: true, bodyMarkdown: true,
      mood: true, tags: true, people: true, highlights: true,
    },
  });

  // Agreguj metadata (rychlý view bez AI)
  const tagCounts = new Map<string, number>();
  const peopleCounts = new Map<string, number>();
  const moodCounts: Record<string, number> = {};
  for (const e of entries) {
    for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    for (const p of e.people) peopleCounts.set(p, (peopleCounts.get(p) ?? 0) + 1);
    if (e.mood) moodCounts[e.mood] = (moodCounts[e.mood] ?? 0) + 1;
  }
  const topTags = Array.from(tagCounts.entries()).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 15);
  const topPeople = Array.from(peopleCounts.entries()).map(([person, count]) => ({ person, count })).sort((a, b) => b.count - a.count).slice(0, 15);

  const yearMonth = `${params.year}-${String(params.month).padStart(2, "0")}`;

  if (entries.length === 0) {
    return {
      yearMonth,
      entryCount: 0,
      reviewMarkdown: "_Žádné zápisy v tomto měsíci._",
      generatedAt: new Date(),
      topTags: [],
      topPeople: [],
      moodHistogram: {},
    };
  }

  // Pro AI: jen metadata + editor notes, žádné body
  const slices = entries.map((e) => {
    const dateStr = e.date.toISOString().slice(0, 10);
    const meta = extractMetaSlice(e.bodyMarkdown);
    return `## ${dateStr}${e.title ? ` — ${e.title}` : ""}\n${meta}`;
  });

  const basePrompt = await getPrompt("denik-monthly-review");
  const prompt = `${basePrompt}

MĚSÍC: ${yearMonth} (${entries.length} zápisů)

VSTUPY (jen METADATA + POZNÁMKY EDITORA každého zápisu, body NEČTEŠ):

${slices.join("\n\n---\n\n")}

Souhrnná čísla:
- Top tagy: ${topTags.slice(0, 10).map((t) => `${t.tag}(${t.count})`).join(", ")}
- Top lidé: ${topPeople.slice(0, 10).map((p) => `${p.person}(${p.count})`).join(", ")}
- Náladové histogram: ${Object.entries(moodCounts).map(([m, c]) => `${m}=${c}`).join(", ")}`;

  const genai = getGemini();
  const response = await callTracked({
    module: "denik-monthly-review",
    modelName: ANALYSIS_MODEL,
    userId: params.userId,
    fn: () => genai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: { temperature: 0.4, maxOutputTokens: 4000 },
    }),
  });

  const reviewMarkdown = (response.text ?? "").trim() || "_AI vrátila prázdný výstup._";

  return {
    yearMonth,
    entryCount: entries.length,
    reviewMarkdown,
    generatedAt: new Date(),
    topTags,
    topPeople,
    moodHistogram: moodCounts,
  };
}
