/**
 * Sekce „Úkoly tento týden" pod týdenním kalendářovým gridem.
 *
 * Plochý vertikální seznam Task entit s dueAt v daném týdnu (Po-Ne).
 * Vizuální výška každé karty je úměrná tagu trvání (t-30m=30px, t-1h=60px,
 * t-2h=120px, t-půlden=240px, t-celý-den=480px). Petr okamžitě vidí kolik
 * času mu které úkoly v týdnu zaberou.
 *
 * Read-only review (žádný drag-and-drop, žádný edit). Klik na kartu vede
 * na /ukoly#<id> pro detail.
 *
 * Sortění: podle dueAt (date), pak priority (high>normal>low).
 *
 * Sticky header s počtem úkolů + sumou hodin (z t-* tagů).
 */
import { useMemo } from "react";
import { Tag, UserCheck, Hourglass, AlertCircle, Briefcase } from "lucide-react";

interface TaskLite {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;       // ISO datetime nebo null
  dueIsTime: boolean;
  tags: string[];
  priority: "low" | "normal" | "high";
  status: string;
  assignedToContactName: string | null;
}

interface Props {
  weekStart: string;          // ISO YYYY-MM-DD pondělí
  tasks: TaskLite[];
}

// Pevná mapa t-* → výška v px (přesně podle Petr-spec).
const T_HEIGHT: Record<string, number> = {
  "t-30m": 30,
  "t-1h": 60,
  "t-2h": 120,
  "t-půlden": 240,
  "t-celý-den": 480,
  "t-?": 60,                  // placeholder výška
};

// t-* → minuty (pro součet hodin v headru). t-? → 0 (neznámé).
const T_MINUTES: Record<string, number> = {
  "t-30m": 30,
  "t-1h": 60,
  "t-2h": 120,
  "t-půlden": 240,            // 4 h
  "t-celý-den": 480,          // 8 h
};

const T_LABEL: Record<string, string> = {
  "t-30m": "30 min",
  "t-1h": "1 h",
  "t-2h": "2 h",
  "t-půlden": "půlden",
  "t-celý-den": "celý den",
  "t-?": "?",
};

const DAY_NAMES_LONG = ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"];

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

function getTTag(tags: string[]): string | null {
  return tags.find((t) => t.startsWith("t-")) ?? null;
}

function getKlientTag(tags: string[]): string | null {
  const found = tags.find((t) => t.startsWith("klient-"));
  if (!found) return null;
  return found.slice("klient-".length);
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length <= 3 && w === w.toLowerCase() ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function fmtMinutes(min: number): string {
  if (min === 0) return "0 h";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export default function WeekTasksList({ weekStart, tasks }: Props) {
  const monday = useMemo(() => new Date(`${weekStart}T00:00:00`), [weekStart]);
  const sunday = useMemo(() => {
    const d = new Date(monday);
    d.setDate(d.getDate() + 6);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [monday]);

  // Filtr na tasks v okně + sortění
  const filtered = useMemo(() => {
    return tasks
      .filter((t) => {
        if (!t.dueAt) return false;
        const d = new Date(t.dueAt);
        return d >= monday && d <= sunday;
      })
      .sort((a, b) => {
        const da = new Date(a.dueAt!).getTime();
        const db = new Date(b.dueAt!).getTime();
        if (da !== db) return da - db;
        return (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
      });
  }, [tasks, monday, sunday]);

  // Součet minut z t-* tagů (t-? se nepočítá — neznámé)
  const { totalMinutes, knownCount, unknownCount } = useMemo(() => {
    let total = 0;
    let known = 0;
    let unknown = 0;
    for (const t of filtered) {
      const tt = getTTag(t.tags);
      if (!tt || tt === "t-?") {
        unknown++;
        continue;
      }
      const mins = T_MINUTES[tt];
      if (mins) {
        total += mins;
        known++;
      }
    }
    return { totalMinutes: total, knownCount: known, unknownCount: unknown };
  }, [filtered]);

  if (filtered.length === 0) {
    return (
      <div className="glass rounded-xl p-5 mt-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">
          <Briefcase className="size-3.5" /> Úkoly tento týden
        </div>
        <p className="text-sm text-muted-foreground italic mt-2">
          Žádný úkol s termínem v tomto týdnu. Diktuj salvu nebo přidej ručně v <a href="/ukoly" className="underline">/ukoly</a>.
        </p>
      </div>
    );
  }

  return (
    <section className="mt-4">
      {/* Sticky header s počtem + sumou hodin */}
      <div
        className="glass-strong rounded-xl px-4 py-3 sticky top-2 z-20 backdrop-blur-md flex items-center gap-3 flex-wrap"
        style={{ background: "color-mix(in oklch, var(--background) 78%, transparent)" }}
      >
        <Briefcase className="size-4 text-[var(--tint-peach)]" />
        <h2 className="font-serif text-lg leading-tight">Úkoly tento týden</h2>
        <span className="text-xs font-mono text-muted-foreground">
          <strong className="text-foreground">{filtered.length}</strong> {filtered.length === 1 ? "úkol" : filtered.length < 5 ? "úkoly" : "úkolů"}
          {" · "}
          <strong className="text-foreground">{fmtMinutes(totalMinutes)}</strong>
          {unknownCount > 0 && (
            <>
              {" · "}
              <span className="text-[var(--tint-butter)]">
                {unknownCount}× t-?
              </span>
            </>
          )}
        </span>
        <a
          href="/ukoly"
          className="ml-auto text-[11px] font-mono text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          → všechny úkoly
        </a>
      </div>

      {/* Plochý vertikální seznam s výškou úměrnou t-* */}
      <div className="space-y-2 mt-3">
        {filtered.map((task) => (
          <TaskCard key={task.id} task={task} weekStart={weekStart} />
        ))}
      </div>
    </section>
  );
}

function TaskCard({ task, weekStart }: { task: TaskLite; weekStart: string }) {
  const tTag = getTTag(task.tags);
  const klientSlug = getKlientTag(task.tags);
  const heightPx = (tTag && T_HEIGHT[tTag]) ?? 60;
  const isUnknownDuration = !tTag || tTag === "t-?";

  const due = task.dueAt ? new Date(task.dueAt) : null;
  const monday = new Date(`${weekStart}T00:00:00`);
  const dayIdx = due ? Math.floor((due.getTime() - monday.getTime()) / (24 * 60 * 60 * 1000)) : -1;
  const dayName = dayIdx >= 0 && dayIdx < 7 ? DAY_NAMES_LONG[(dayIdx + 1) % 7] : "—";

  // Tagy bez t-* a klient-* (ty zobrazujeme zvlášť)
  const otherTags = task.tags.filter((t) => !t.startsWith("t-") && !t.startsWith("klient-"));

  // Tint podle priority + klient/team status
  const tint = klientSlug ? "sky" : task.priority === "high" ? "rose" : task.assignedToContactName ? "lavender" : "peach";

  return (
    <a
      href={`/ukoly#task-${task.id}`}
      className="block glass rounded-xl overflow-hidden transition-all hover:brightness-110 hover:scale-[1.005]"
      style={{
        ["--c" as string]: `var(--tint-${tint})`,
        height: `${heightPx}px`,
        minHeight: heightPx,
        borderLeft: `3px solid color-mix(in oklch, var(--tint-${tint}) 50%, transparent)`,
      }}
    >
      <div className="h-full flex flex-col px-3 py-2 overflow-hidden">
        {/* Top row: title + t-* badge */}
        <div className="flex items-start gap-2 flex-wrap">
          <span className="font-medium text-sm leading-snug flex-1 min-w-0">
            {task.title}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
              style={{
                background: isUnknownDuration
                  ? "color-mix(in oklch, var(--tint-butter) 15%, transparent)"
                  : "color-mix(in oklch, var(--tint-lavender) 15%, transparent)",
                color: isUnknownDuration
                  ? "color-mix(in oklch, var(--tint-butter) 92%, white)"
                  : "color-mix(in oklch, var(--tint-lavender) 92%, white)",
                border: `1px solid color-mix(in oklch, var(--tint-${isUnknownDuration ? "butter" : "lavender"}) 30%, transparent)`,
              }}
              title={isUnknownDuration ? "Trvání nezvolené — vrať se do Triage" : `Trvání: ${T_LABEL[tTag!]}`}
            >
              <Hourglass className="size-2.5" />
              {tTag ? T_LABEL[tTag] : "?"}
            </span>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] font-mono text-muted-foreground">
          <span>{dayName}</span>
          {task.dueIsTime && due && (
            <span>{due.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</span>
          )}
          {task.priority === "high" && (
            <span className="text-[var(--tint-rose)] flex items-center gap-1">
              <AlertCircle className="size-3" /> priorita
            </span>
          )}
          {task.priority === "low" && <span>↓ low</span>}
          {task.assignedToContactName && (
            <span className="flex items-center gap-1 text-[var(--tint-lavender)]">
              <UserCheck className="size-3" /> {task.assignedToContactName}
            </span>
          )}
          {klientSlug && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
              style={{
                background: "color-mix(in oklch, var(--tint-sky) 14%, transparent)",
                color: "color-mix(in oklch, var(--tint-sky) 92%, white)",
                border: "1px solid color-mix(in oklch, var(--tint-sky) 30%, transparent)",
              }}
            >
              <Briefcase className="size-2.5" /> {humanizeSlug(klientSlug)}
            </span>
          )}
          {otherTags.length > 0 && (
            <span className="flex items-center gap-1 truncate min-w-0">
              <Tag className="size-3 shrink-0" />
              <span className="truncate">{otherTags.map((t) => `#${t}`).join(" ")}</span>
            </span>
          )}
        </div>

        {/* Notes (jen u větších karet — t-2h+) */}
        {heightPx >= 120 && task.notes && (
          <div className="mt-2 text-xs text-muted-foreground/85 leading-relaxed line-clamp-3">
            {task.notes}
          </div>
        )}
      </div>
    </a>
  );
}
