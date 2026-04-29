import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/denik/search?q=...&person=...&tag=...&from=YYYY-MM-DD&to=YYYY-MM-DD&mood=...
 *
 * Vyhledávání v deníkových záznamech:
 *   - q: fulltext v bodyMarkdown + rawTranscript (case-insensitive ILIKE)
 *   - person: konkrétní osoba (z hlavičky LIDÉ → people[] field), case-insensitive
 *   - tag: konkrétní téma (z TÉMATA → tags[])
 *   - from/to: date range
 *   - mood: jeden z enum hodnot
 *
 * Vrací entries (max 100) seřazené chronologicky desc.
 * Plus aggregovaná facets (top tagy a lidé v matched results) pro filter UI.
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const q = url.searchParams.get("q")?.trim() ?? "";
  const person = url.searchParams.get("person")?.trim() ?? "";
  const tag = url.searchParams.get("tag")?.trim() ?? "";
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const mood = url.searchParams.get("mood");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { userId: session.uid };

  if (fromStr || toStr) {
    where.date = {};
    if (fromStr && /^\d{4}-\d{2}-\d{2}$/.test(fromStr)) where.date.gte = new Date(`${fromStr}T00:00:00`);
    if (toStr && /^\d{4}-\d{2}-\d{2}$/.test(toStr)) where.date.lte = new Date(`${toStr}T23:59:59`);
  }

  if (mood) where.mood = mood;
  if (tag) where.tags = { has: tag };
  if (person) {
    // Postgres array contains case-sensitive — pro case-insensitive search
    // hlavu, najdeme všechny entries kde nějaká položka people[] obsahuje
    // person (ILIKE). Prisma neumí array-element-ILIKE napřímo, použijeme
    // raw query pro filtrování.
    const personLower = person.toLowerCase();
    const matches = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "JournalEntry"
      WHERE "userId" = ${session.uid}
        AND EXISTS (
          SELECT 1 FROM unnest("people") AS p
          WHERE LOWER(p) LIKE ${`%${personLower}%`}
        )
    `;
    where.id = { in: matches.map((m) => m.id) };
  }

  if (q) {
    where.OR = [
      { bodyMarkdown: { contains: q, mode: "insensitive" } },
      { rawTranscript: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
    ];
  }

  const entries = await prisma.journalEntry.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  // Facets — top tagy a lidé v matched results (pro filter UI)
  const tagCounts = new Map<string, number>();
  const peopleCounts = new Map<string, number>();
  for (const e of entries) {
    for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    for (const p of e.people) peopleCounts.set(p, (peopleCounts.get(p) ?? 0) + 1);
  }
  const topTags = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  const topPeople = Array.from(peopleCounts.entries())
    .map(([person, count]) => ({ person, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return Response.json({ entries, facets: { tags: topTags, people: topPeople } });
};
