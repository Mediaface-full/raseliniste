/**
 * Weekly review AI asistent (Petr 2026-07-22, ADHD F2).
 *
 * Vezme backlog + termíny + kalendářovou vytíženost týdne a navrhne
 * každému úkolu plánovaný den výroby (Task.plannedFor). Gideon návrhy
 * jen potvrdí/upraví na /planovani — AI nikdy nezapisuje sama.
 *
 * Pravidla v promptu: WIP max 3/den, batching podle projektu (stejný
 * klient stejný den), respektovat termíny, dny plné schůzek dostávají
 * méně úkolů, víkend jen když je to nutné.
 */

import { z } from "zod";
import { prisma } from "./db";
import { getGemini, FAST_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";
import { getWeekTemplate, MODE_INFO, type TemplateDay } from "./week-template";

const WIP_LIMIT = 3;

const responseSchema = z.object({
  assignments: z.array(z.object({
    task_id: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().max(200).optional().nullable(),
  })),
  warnings: z.array(z.string()).optional().nullable(),
});

export interface PlanProposal {
  taskId: string;
  title: string;
  date: string;
  reason: string | null;
}

export interface WeekPlanResult {
  proposals: PlanProposal[];
  warnings: string[];
}

function extractJson(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch { /* níž */ }
  const s = t.indexOf("{"); const e = t.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error("AI nevrátila validní JSON.");
}

export async function proposeWeekPlan(userId: string, mondayKey: string): Promise<WeekPlanResult> {
  const monday = new Date(`${mondayKey}T00:00:00`);
  const nextMonday = new Date(monday); nextMonday.setDate(nextMonday.getDate() + 7);
  const dkey = (d: Date) => d.toLocaleDateString("sv-SE");
  const todayKey = dkey(new Date());

  const [unplanned, overduePlanned, plannedInWeek, events, projects] = await Promise.all([
    prisma.task.findMany({
      where: { userId, status: "open", plannedFor: null },
      select: { id: true, title: true, priority: true, dueAt: true, tags: true, todoistProjectId: true },
      orderBy: [{ priority: "desc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 60,
    }),
    prisma.task.findMany({
      where: { userId, status: "open", plannedFor: { lt: monday } },
      select: { id: true, title: true, priority: true, dueAt: true, tags: true, todoistProjectId: true },
      orderBy: { plannedFor: "asc" },
      take: 20,
    }),
    prisma.task.findMany({
      where: { userId, status: "open", plannedFor: { gte: monday, lt: nextMonday } },
      select: { id: true, title: true, plannedFor: true },
    }),
    prisma.calendarEvent.findMany({
      where: {
        deletedRemotely: false,
        source: { not: "LOCAL_ICS" },
        AND: [{ endsAt: { gt: monday } }, { startsAt: { lt: nextMonday } }],
      },
      select: { title: true, startsAt: true, endsAt: true, allDay: true },
      orderBy: { startsAt: "asc" },
      take: 80,
    }),
    prisma.todoistProjectMirror.findMany({ where: { userId }, select: { todoistId: true, name: true } }),
  ]);

  const candidates = [...overduePlanned, ...unplanned];
  if (candidates.length === 0) return { proposals: [], warnings: ["Backlog je prázdný — není co plánovat."] };

  const projectNames = new Map(projects.map((p) => [p.todoistId, p.name]));
  const fmtTask = (t: (typeof candidates)[number]) => {
    const parts = [
      `id=${t.id}`,
      `"${t.title}"`,
      `priorita=${t.priority}`,
      t.dueAt ? `termín=${dkey(t.dueAt)}` : null,
      t.todoistProjectId && projectNames.get(t.todoistProjectId) ? `projekt=${projectNames.get(t.todoistProjectId)}` : null,
      t.tags.length ? `tagy=${t.tags.join(",")}` : null,
    ].filter(Boolean);
    return `- ${parts.join(" | ")}`;
  };

  // Kalendářová vytíženost per den (hodiny schůzek, bez all-day)
  const busy = new Map<string, number>();
  const allDayNotes = new Map<string, string[]>();
  for (const e of events) {
    const key = dkey(e.startsAt);
    if (e.allDay) {
      const arr = allDayNotes.get(key) ?? [];
      arr.push(e.title);
      allDayNotes.set(key, arr);
    } else {
      const hrs = (e.endsAt.getTime() - e.startsAt.getTime()) / 3_600_000;
      busy.set(key, (busy.get(key) ?? 0) + hrs);
    }
  }
  const existingPerDay = new Map<string, number>();
  for (const t of plannedInWeek) {
    const key = t.plannedFor ? dkey(t.plannedFor) : "";
    existingPerDay.set(key, (existingPerDay.get(key) ?? 0) + 1);
  }

  const template = await getWeekTemplate().catch(() => new Map<number, TemplateDay>());
  const DAY_LABELS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
  const dayLines = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(d.getDate() + i);
    const key = dkey(d);
    const tpl = template.get(i);
    const parts = [
      `${key} (${DAY_LABELS[i]})`,
      key < todayKey ? "UŽ PROBĚHL — nepoužívat" : null,
      tpl ? `režim: ${MODE_INFO[tpl.mode].name}${tpl.label ? ` (${tpl.label})` : ""} — ${MODE_INFO[tpl.mode].hint}` : null,
      `schůzek: ${(busy.get(key) ?? 0).toFixed(1)} h`,
      `už naplánováno úkolů: ${existingPerDay.get(key) ?? 0}`,
      allDayNotes.get(key)?.length ? `celodenní: ${allDayNotes.get(key)!.join(", ")}` : null,
    ].filter(Boolean);
    return `- ${parts.join(" | ")}`;
  });
  const templateRule = template.size > 0
    ? `7. Respektuj režimy dnů: Maker dny = deep work pro klientské úkoly. Manager dny = admin, fakturace, drobnosti, přípravy. „Vlastní" dny jsou NEDOTKNUTELNÉ — plánuj tam VÝHRADNĚ úkoly vlastních projektů (ne klientské). „Volno" dny neplánuj vůbec.`
    : "";

  const prompt = `Jsi plánovací asistent pro kreativce s ADHD (Gideon, majitel studia).
Navrhni, KTERÝ DEN v týdnu ${mondayKey} až ${dkey(new Date(nextMonday.getTime() - 86400000))} bude dělat které úkoly.

PRAVIDLA (tvrdá):
1. Max ${WIP_LIMIT} úkoly na den VČETNĚ už naplánovaných (viz kapacita dnů). Radši úkol nenaplánovat než přeplnit den.
2. Dny, které už proběhly, nepoužívej.
3. Batching: úkoly stejného projektu/klienta dávej na stejný den (přepínání kontextu je drahé).
4. Úkoly s termínem naplánuj NEJPOZDĚJI na den termínu; s prioritou high co nejdřív.
5. Dny s hodně schůzkami (>3 h) dostávají max 1 úkol. Víkend použij jen pro úkoly s víkendovým termínem.
6. Nenaplánované úkoly prostě vynech (zůstanou v backlogu) — nevymýšlej nové.
${templateRule}

DNY TÝDNE A KAPACITA:
${dayLines.join("\n")}

ÚKOLY K NAPLÁNOVÁNÍ (kandidáti):
${candidates.map(fmtTask).join("\n")}

Vrať POUZE JSON:
{"assignments": [{"task_id": "…", "date": "YYYY-MM-DD", "reason": "krátce česky proč tento den"}], "warnings": ["česká upozornění — přetečení kapacity, úkoly co se nevešly, kolize termínů"]}`;

  const ai = getGemini();
  const response = await callTracked({
    module: "planovani-navrh",
    modelName: FAST_MODEL,
    fn: () => ai.models.generateContent({
      model: FAST_MODEL,
      contents: prompt,
      config: { temperature: 0.2, maxOutputTokens: 8000, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 1024 } },
    }),
  });

  const parsed = responseSchema.parse(extractJson(response.text ?? ""));
  const known = new Map(candidates.map((t) => [t.id, t.title]));
  const weekKeys = new Set(Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return dkey(d); }));

  // Tvrdá validace + enforcement WIP limitu v kódu (AI je jen návrh)
  const perDay = new Map<string, number>(existingPerDay);
  const proposals: PlanProposal[] = [];
  const seen = new Set<string>();
  for (const a of parsed.assignments) {
    if (!known.has(a.task_id) || seen.has(a.task_id)) continue;
    if (!weekKeys.has(a.date) || a.date < todayKey) continue;
    if ((perDay.get(a.date) ?? 0) >= WIP_LIMIT) continue;
    perDay.set(a.date, (perDay.get(a.date) ?? 0) + 1);
    seen.add(a.task_id);
    proposals.push({ taskId: a.task_id, title: known.get(a.task_id)!, date: a.date, reason: a.reason ?? null });
  }

  return { proposals, warnings: (parsed.warnings ?? []).slice(0, 10) };
}
