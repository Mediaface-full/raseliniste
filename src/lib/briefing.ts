import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import { createTask } from "./todoist";
import { getGemini, ANALYSIS_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";

/**
 * Noční briefing 22:00 → Todoist.
 *
 * Pipeline:
 *  1) Načti všechny zítřejší události (Google + iCloud syn + iCloud partnerka)
 *  2) Načti DayNotes pro zítra (done=false) + nedořešené RuleViolation
 *  3) Vertex Flash → strukturované JSON (schedule, items, dayNotes, contextWarnings, commute)
 *  4) Render markdown podle template z briefu sekce 10.1
 *  5) Push do Todoistu (config.mojeUkoly), uložit BriefingDigest
 *
 * Idempotence: pokud BriefingDigest pro daný `forDate` už existuje, skip
 * (pokud `force=true`, smaže předchozí a regeneruje).
 */

export interface BriefingContent {
  schedule: Array<{
    type: string;          // EventType
    source: string;        // CalendarSource
    startsAt: string;      // ISO
    endsAt: string;
    title: string;
    location: string | null;
    prep: string | null;
    bring: string[];
    isContext: boolean;    // true = jen kontext (synův hokej, partnerčina šichta)
  }>;
  itemsToBringAggregate: Array<{ name: string; forPerson: string | null; sourceEventTitle: string }>;
  dayNotes: Array<{ id: string; text: string; area: string | null }>;
  contextWarnings: string[];   // "partnerka má NOCNI", "syn doma sám 16-19", ...
  commuteSummary: string | null;
  ruleWarnings: Array<{ rule: string; severity: string; message: string }>;
}

export interface BriefingResult {
  digestId: string;
  todoistTaskId: string | null;
  markdown: string;
  content: BriefingContent;
  skipped: boolean;
  reason?: string;
}

export async function generateBriefing(
  userId: string,
  forDate: Date,
  opts: { force?: boolean; pushToTodoist?: boolean } = {},
): Promise<BriefingResult> {
  const { force = false, pushToTodoist = true } = opts;

  // forDate normalize na 00:00:00 (UTC date)
  const dayStart = new Date(forDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  // Idempotence
  const existing = await prisma.briefingDigest.findUnique({
    where: { forDate: dayStart },
  });
  if (existing && !force) {
    return {
      digestId: existing.id,
      todoistTaskId: existing.todoistTaskId,
      markdown: renderMarkdown(existing.content as unknown as BriefingContent, dayStart),
      content: existing.content as unknown as BriefingContent,
      skipped: true,
      reason: "Briefing pro tento den už existuje (idempotent skip).",
    };
  }
  if (existing && force) {
    await prisma.briefingDigest.delete({ where: { id: existing.id } });
  }

  // 1) Načti vstupy
  const events = await prisma.calendarEvent.findMany({
    where: {
      deletedRemotely: false,
      AND: [{ endsAt: { gte: dayStart } }, { startsAt: { lte: dayEnd } }],
    },
    orderBy: { startsAt: "asc" },
  });

  const dayNotes = await prisma.dayNote.findMany({
    where: { forDate: dayStart, done: false },
    orderBy: { createdAt: "asc" },
  });

  const violations = await prisma.ruleViolation.findMany({
    where: { forDate: dayStart, acknowledged: false },
  });

  // 2) Vertex Flash structured generation
  const content = await callVertexBriefing(events, dayNotes, violations, dayStart);

  // 3) Render markdown
  const markdown = renderMarkdown(content, dayStart);

  // 4) Uložit BriefingDigest
  const digest = await prisma.briefingDigest.create({
    data: {
      forDate: dayStart,
      content: content as unknown as never,
    },
  });

  // 5) Push do Todoistu (optional)
  let todoistTaskId: string | null = null;
  if (pushToTodoist) {
    try {
      todoistTaskId = await pushBriefingToTodoist(userId, dayStart, markdown);
      await prisma.briefingDigest.update({
        where: { id: digest.id },
        data: { todoistTaskId, pushedAt: new Date() },
      });
    } catch (e) {
      console.error("[briefing] Todoist push failed:", e);
      // Briefing zůstane uložený, jen bez Todoist tasku
    }
  }

  return {
    digestId: digest.id,
    todoistTaskId,
    markdown,
    content,
    skipped: false,
  };
}

// ---------------------------------------------------------------------------
// Vertex Flash — strukturované JSON content
// ---------------------------------------------------------------------------

async function callVertexBriefing(
  events: Array<{
    id: string; type: string; source: string; title: string;
    description: string | null; locationText: string | null;
    startsAt: Date; endsAt: Date; allDay: boolean;
    prepNote: string | null; itemsToBring: unknown;
  }>,
  dayNotes: Array<{ id: string; text: string; area: string | null }>,
  violations: Array<{ ruleName: string; severity: string; message: string }>,
  forDate: Date,
): Promise<BriefingContent> {
  // Pokud nic není, vrátíme prázdný briefing bez volání Vertex.
  if (events.length === 0 && dayNotes.length === 0 && violations.length === 0) {
    return emptyContent();
  }

  const dateStr = forDate.toLocaleDateString("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const eventsForPrompt = events.map((e) => ({
    type: e.type,
    source: e.source,
    title: e.title,
    location: e.locationText,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    allDay: e.allDay,
    prep: e.prepNote,
    bring: Array.isArray(e.itemsToBring) ? e.itemsToBring : null,
    description: (e.description ?? "").slice(0, 500),
  }));

  const prompt = `Vygeneruj strukturovaný briefing pro Petra na den **${dateStr}**.

VSTUP — UDÁLOSTI:
${JSON.stringify(eventsForPrompt, null, 2)}

VSTUP — DAY NOTES (errands, věci „při cestě"):
${JSON.stringify(dayNotes, null, 2)}

VSTUP — AKTIVNÍ PORUŠENÍ PRAVIDEL:
${JSON.stringify(violations, null, 2)}

PRAVIDLA:
- Vrať POUZE jeden JSON objekt přesně podle níže uvedeného schématu, bez markdownu.
- Petrovy schůzky (source=GOOGLE_PRIMARY) jsou hlavní program.
- Synovy události (source=ICLOUD_SON, type=HOCKEY_SON) jsou KONTEXT — Petr je zodpovědný za doprovod / vyzvednutí.
- Partnerčiny šichty (source=ICLOUD_PARTNER, type=PARTNER_SHIFT) jsou KONTEXT — ovlivňují kdo má kluka.
- "isContext: true" pro synovy/partnerčiny věci, "false" pro Petrovy.
- Pro každou Petrovu schůzku zvaž "co vzít s sebou" — pokud z popisu nebo titulu plyne (smlouva, pas, knížky pro někoho), vyplň "bring" jako pole stringů.
- "itemsToBringAggregate" sloučí všechny bring položky do jednoho seznamu (pro packing list ráno).
- "contextWarnings" — krátké české věty: "Partnerka má NOCNI šichtu — po návratu klid", "Syn na hokeji 16-19", "Partnerka pryč — sám se synem", apod.
- "commuteSummary" — pokud je v plánu Praha, doplň krátkou poznámku o cestování (např. "60 min do Prahy ze Studené").
- "ruleWarnings" — kopíruj violations do strukturovaného formátu.

JSON SCHEMA:
{
  "schedule": [{
    "type": string, "source": string, "startsAt": string, "endsAt": string,
    "title": string, "location": string|null, "prep": string|null,
    "bring": string[], "isContext": boolean
  }],
  "itemsToBringAggregate": [{"name": string, "forPerson": string|null, "sourceEventTitle": string}],
  "dayNotes": [{"id": string, "text": string, "area": string|null}],
  "contextWarnings": string[],
  "commuteSummary": string|null,
  "ruleWarnings": [{"rule": string, "severity": string, "message": string}]
}

Vrať POUZE JSON, žádný další text.`;

  const genai = getGemini();
  const response = await callTracked({
    module: "briefing",
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

  const text = (response.text ?? "").trim();
  try {
    const parsed = JSON.parse(text) as BriefingContent;
    // Sanity defaults
    return {
      schedule: parsed.schedule ?? [],
      itemsToBringAggregate: parsed.itemsToBringAggregate ?? [],
      dayNotes: parsed.dayNotes ?? dayNotes.map((d) => ({ id: d.id, text: d.text, area: d.area })),
      contextWarnings: parsed.contextWarnings ?? [],
      commuteSummary: parsed.commuteSummary ?? null,
      ruleWarnings: parsed.ruleWarnings ?? violations.map((v) => ({
        rule: v.ruleName, severity: v.severity, message: v.message,
      })),
    };
  } catch (e) {
    console.error("[briefing] Vertex JSON parse failed:", e, "text:", text.slice(0, 200));
    // Fallback: vyrob content ručně bez AI
    return fallbackContent(events, dayNotes, violations);
  }
}

function emptyContent(): BriefingContent {
  return {
    schedule: [],
    itemsToBringAggregate: [],
    dayNotes: [],
    contextWarnings: [],
    commuteSummary: null,
    ruleWarnings: [],
  };
}

function fallbackContent(
  events: Array<{
    type: string; source: string; title: string; locationText: string | null;
    startsAt: Date; endsAt: Date; allDay: boolean; prepNote: string | null;
  }>,
  dayNotes: Array<{ id: string; text: string; area: string | null }>,
  violations: Array<{ ruleName: string; severity: string; message: string }>,
): BriefingContent {
  return {
    schedule: events.map((e) => ({
      type: e.type,
      source: e.source,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      title: e.title,
      location: e.locationText,
      prep: e.prepNote,
      bring: [],
      isContext: e.source === "ICLOUD_SON" || e.source === "ICLOUD_PARTNER",
    })),
    itemsToBringAggregate: [],
    dayNotes: dayNotes.map((d) => ({ id: d.id, text: d.text, area: d.area })),
    contextWarnings: [],
    commuteSummary: null,
    ruleWarnings: violations.map((v) => ({
      rule: v.ruleName, severity: v.severity, message: v.message,
    })),
  };
}

// ---------------------------------------------------------------------------
// Markdown render — podle template z briefu sekce 10.1
// ---------------------------------------------------------------------------

function renderMarkdown(content: BriefingContent, forDate: Date): string {
  const dateStr = forDate.toLocaleDateString("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const lines: string[] = [];
  lines.push(`🌙 Plán na zítra — ${dateStr}`);
  lines.push("");

  // 🎒 Vzít s sebou
  if (content.itemsToBringAggregate.length > 0) {
    lines.push("## 🎒 Vzít s sebou");
    for (const item of content.itemsToBringAggregate) {
      const ctx = item.forPerson
        ? ` (pro ${item.forPerson}, event ${item.sourceEventTitle})`
        : ` (event ${item.sourceEventTitle})`;
      lines.push(`- [ ] ${item.name}${ctx}`);
    }
    lines.push("");
  }

  // 📍 Schůzky (Petrovy, ne kontext)
  const myMeetings = content.schedule.filter((s) => !s.isContext);
  if (myMeetings.length > 0) {
    lines.push("## 📍 Schůzky");
    for (const s of myMeetings) {
      const start = new Date(s.startsAt);
      const end = new Date(s.endsAt);
      const time = `${fmtTime(start)}–${fmtTime(end)}`;
      const loc = s.location ? ` · ${s.location}` : "";
      lines.push(`**${time}${loc} · ${s.title}**`);
      if (s.prep) lines.push(`- Příprava: ${s.prep}`);
      if (s.bring.length > 0) lines.push(`- Bring: ${s.bring.join(", ")}`);
      lines.push("");
    }
  }

  // 🛒 Při cestě
  if (content.dayNotes.length > 0) {
    lines.push("## 🛒 Při cestě");
    for (const n of content.dayNotes) {
      const area = n.area ? ` (${n.area})` : "";
      lines.push(`- [ ] ${n.text}${area}`);
    }
    lines.push("");
  }

  // 💡 Kontext (synovy/partnerčiny věci + warnings)
  const contextItems = content.schedule.filter((s) => s.isContext);
  const hasContext = contextItems.length > 0 || content.contextWarnings.length > 0 || content.commuteSummary;
  if (hasContext) {
    lines.push("## 💡 Kontext");
    for (const w of content.contextWarnings) lines.push(`- ${w}`);
    for (const c of contextItems) {
      const start = new Date(c.startsAt);
      const end = new Date(c.endsAt);
      const time = c.startsAt && !isNaN(start.getTime())
        ? `${fmtTime(start)}–${fmtTime(end)}`
        : "celý den";
      lines.push(`- ${c.title} (${time})`);
    }
    if (content.commuteSummary) lines.push(`- 🚌 ${content.commuteSummary}`);
    lines.push("");
  }

  // ⚠ Pravidla
  if (content.ruleWarnings.length > 0) {
    lines.push("## ⚠ Pravidla — pozor");
    for (const r of content.ruleWarnings) {
      const icon = r.severity === "ERROR" ? "🔴" : r.severity === "WARNING" ? "🟡" : "ℹ️";
      lines.push(`- ${icon} ${r.message}`);
    }
    lines.push("");
  }

  if (myMeetings.length === 0 && content.dayNotes.length === 0) {
    lines.push("_Žádné schůzky ani úkoly. Užij si volno._");
    lines.push("");
  }

  lines.push("---");
  lines.push(
    `_Vygenerováno z ${content.schedule.length} události, ${content.dayNotes.length} day notes, ${content.ruleWarnings.length} warnings._`,
  );

  return lines.join("\n");
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// ---------------------------------------------------------------------------
// Todoist push
// ---------------------------------------------------------------------------

async function pushBriefingToTodoist(
  userId: string,
  forDate: Date,
  markdown: string,
): Promise<string> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "todoist" } },
  });
  if (!integration) {
    throw new Error("Todoist integrace není nakonfigurovaná.");
  }
  const token = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });
  const cfg = ((integration.config as unknown) ?? {}) as {
    mojeUkoly?: string;
  };
  const projectId = cfg.mojeUkoly || undefined;

  const dateLabel = forDate.toLocaleDateString("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  });

  const task = await createTask(token, {
    content: `🌙 Plán na ${dateLabel}`,
    description: markdown.slice(0, 16000), // Todoist description limit
    project_id: projectId,
    priority: 2,
    due_string: "today",
    labels: ["briefing"],
  });

  await prisma.userIntegration.update({
    where: { id: integration.id },
    data: { lastUsedAt: new Date(), lastError: null },
  });

  return task.id;
}
