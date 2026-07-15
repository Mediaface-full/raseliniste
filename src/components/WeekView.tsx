/**
 * Týdenní pohled — desktop. 7 sloupců (Po-Ne) × časová osa 6:00-23:00.
 *
 * Klíčové návrhové principy:
 * - Barva = zdroj (sky=Petr, rose=partnerka, mint=syn, butter=ostatní, peach=rituál)
 * - Aktuální den: subtle podbarvení sloupce + jasný horní border
 * - Aktuální čas: terakotová čára napříč VŠEMI sloupci
 * - Rituály: tečkovaný okraj + peach tint, vizuální váha jako schůzky
 * - Čas nahoře, název pod (jako v DayTimeline)
 * - Long event (>3h) co overlapuje: background s opacitou
 * - Žádný drag-and-drop, žádný editing
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Maximize2, MapPin, X, Sparkles, Printer } from "lucide-react";
import { marked } from "marked";
import { DEFAULT_RITUAL_TEMPLATES, type RitualType } from "@/lib/week-rituals";
import WeekTasksList from "./WeekTasksList";

interface WeekTask {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  dueIsTime: boolean;
  tags: string[];
  priority: "low" | "normal" | "high";
  status: string;
  assignedToContactName: string | null;
}

function ritualTypeFromId(id: string): RitualType | null {
  if (id.startsWith("ritual-morning-")) return "morning_day";
  if (id.startsWith("ritual-friday-")) return "friday_reflection";
  if (id.startsWith("ritual-sunday-")) return "weekly_review";
  return null;
}

interface CalEvent {
  id: string;
  title: string;
  type: string;
  source: string;
  startsAt: string;
  endsAt: string;
  locationText: string | null;
  description: string | null;
  prepNote: string | null;
  itemsToBring: unknown;
  allDay: boolean;
}

interface Props {
  events: CalEvent[];
  weekStart: string; // ISO date YYYY-MM-DD = pondělí
  rituals: CalEvent[]; // virtual rituály
  interpretation: string[];
  prevWeekHref: string;
  nextWeekHref: string;
  thisWeekHref: string;
  fullscreenHref?: string; // pokud zobrazení není fullscreen, link na fullscreen variantu
  isFullscreen?: boolean;
  exitFullscreenHref?: string; // pokud isFullscreen=true
  // Úkoly s dueAt v aktuálním týdnu — sekce „Úkoly tento týden" pod gridem.
  // Default [] (zpětná kompatibilita s místy kde se WeekView použije bez tasks).
  weekTasks?: WeekTask[];
}

const HOUR_START = 6;
const HOUR_END = 23;
const HOURS_VISIBLE = HOUR_END - HOUR_START; // 17
const HOUR_PX = 56;
const TIME_GUTTER_PX = 56;
const DAY_NAMES_SHORT = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

function sourceTint(src: string): string {
  if (src === "RITUAL") return "peach";
  if (src === "ANNIVERSARY") return "pink";
  if (src === "ICLOUD_PARTNER") return "rose";
  if (src === "ICLOUD_SON") return "mint";
  if (src === "GOOGLE_PRIMARY") return "sky";
  if (src === "LOCAL_ICS") return "sage";
  return "butter";
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function WeekView({
  events,
  weekStart,
  rituals,
  interpretation,
  prevWeekHref,
  nextWeekHref,
  thisWeekHref,
  fullscreenHref,
  isFullscreen,
  exitFullscreenHref,
  weekTasks = [],
}: Props) {
  const [now, setNow] = useState(() => new Date());
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Tooltip sleduje kurzor (clientX/Y). Portal-rendered do <body> aby unikl
  // jakýmkoliv ancestor transforms/filters co by zlomily fixed positioning.
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
    const tick = () => setNow(new Date());
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, []);

  function handleHover(id: string, mouseX: number, mouseY: number) {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoverPos({ x: mouseX, y: mouseY });
    hoverTimeoutRef.current = setTimeout(() => setHoveredId(id), 80);
  }
  function handleMove(mouseX: number, mouseY: number) {
    setHoverPos({ x: mouseX, y: mouseY });
  }
  function handleLeave() {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setHoveredId(null), 80);
  }

  const monday = useMemo(() => {
    const d = new Date(`${weekStart}T00:00:00`);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [weekStart]);

  // Rozsah týdne v textu hlavičky
  const weekRangeLabel = useMemo(() => {
    const sun = new Date(monday);
    sun.setDate(sun.getDate() + 6);
    const sameMonth = monday.getMonth() === sun.getMonth();
    const months = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
    if (sameMonth) {
      return `Týden ${monday.getDate()}.–${sun.getDate()}. ${months[monday.getMonth()]} ${sun.getFullYear()}`;
    }
    return `Týden ${monday.getDate()}. ${months[monday.getMonth()]} – ${sun.getDate()}. ${months[sun.getMonth()]} ${sun.getFullYear()}`;
  }, [monday]);

  // Sloučí real eventy + rituály a rozdělí podle dne (0 = Po)
  const allEvents = useMemo(() => [...events, ...rituals], [events, rituals]);

  type ByDay = { timed: CalEvent[] };
  const byDay = useMemo<ByDay[]>(() => {
    const result: ByDay[] = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(monday);
      dayStart.setDate(dayStart.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      const dayEvents = allEvents.filter((e) => {
        if (e.allDay) return false; // all-day jdou do separátní sekce
        const s = new Date(e.startsAt);
        const en = new Date(e.endsAt);
        return en > dayStart && s <= dayEnd;
      });
      result.push({
        timed: dayEvents,
      });
    }
    return result;
  }, [allEvents, monday]);

  // All-day eventy — spanning přes víc dní. Spočítáme startCol/endCol pro
  // každý unikátní all-day event. Multi-day = jeden vizuální blok přes více
  // sloupců, ne separátní badge per den.
  type AllDaySpan = {
    event: CalEvent;
    startCol: number; // 0..6 (Po..Ne) inclusive
    endCol: number;
    row: number; // pro stacking
  };
  const allDaySpans = useMemo<AllDaySpan[]>(() => {
    // KLÍČOVÉ: porovnáváme kalendářní dny v PRAHA TZ, ne UTC ms.
    // UTC posun (CEST = +2) způsoboval že 1-den allDay event uložený jako
    // 2026-05-09T00:00:00Z se zobrazil přes 2 dny — endAdjusted se v UTC
    // počítání "překlopilo" do následujícího dne.
    const dayKey = (d: Date): string =>
      d.toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" });

    const weekDayKeys: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      weekDayKeys.push(dayKey(d));
    }

    const allDayList = allEvents.filter((e) => e.allDay);
    const spans: AllDaySpan[] = [];
    for (const e of allDayList) {
      const start = new Date(e.startsAt);
      const end = new Date(e.endsAt);
      // V Google/iCal je `endsAt` exclusive pro all-day. Posun zpět musí být
      // dost velký, aby v každé TZ skončil v PŘEDCHOZÍM kalendářním dni.
      // Worst case: server uložil endsAt s posunutím +offset (např. Praha
      // = +2h CEST), klient v Praze je +2h. Použijeme -12h = polovinu dne.
      // Tím vždy spadne do druhé poloviny předchozího dne v jakékoli TZ.
      // Pro all-day eventy je to bezpečné (žádný legitimní 12h all-day end posun).
      const endAdjusted = new Date(end.getTime() - 12 * 60 * 60 * 1000);

      const startKey = dayKey(start);
      const endKey = dayKey(endAdjusted);

      let startCol = weekDayKeys.indexOf(startKey);
      let endCol = weekDayKeys.indexOf(endKey);

      // Pokud event přesahuje týden zleva/zprava, ořež na rozsah
      if (startCol === -1 && endCol === -1) {
        // Možná oba před týdnem nebo za týdnem? Zkontroluj jestli event
        // protíná týden vůbec — porovnání day keys
        if (startKey > weekDayKeys[6] || endKey < weekDayKeys[0]) continue;
      }
      if (startCol === -1) startCol = 0;
      if (endCol === -1) endCol = 6;
      if (endCol < startCol) continue;

      spans.push({ event: e, startCol, endCol, row: 0 });
    }
    // Greedy assign rows — minimalizuje překryv
    spans.sort((a, b) => a.startCol - b.startCol);
    const rowEnds: number[] = []; // poslední endCol per row
    for (const span of spans) {
      let assigned = -1;
      for (let r = 0; r < rowEnds.length; r++) {
        if (rowEnds[r] < span.startCol) {
          assigned = r;
          break;
        }
      }
      if (assigned === -1) {
        assigned = rowEnds.length;
        rowEnds.push(0);
      }
      span.row = assigned;
      rowEnds[assigned] = span.endCol;
    }
    return spans;
  }, [allEvents, monday]);

  const allDayRows = useMemo(
    () => Math.max(1, Math.max(...allDaySpans.map((s) => s.row + 1), 0)),
    [allDaySpans],
  );
  const ALL_DAY_VISIBLE_ROWS = 2;
  const [allDayExpanded, setAllDayExpanded] = useState(false);
  const visibleAllDayRows = allDayExpanded ? allDayRows : Math.min(ALL_DAY_VISIBLE_ROWS, allDayRows);
  const hiddenSpansCount = allDaySpans.filter((s) => s.row >= visibleAllDayRows).length;

  const todayDayIndex = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const diffDays = Math.round((t.getTime() - monday.getTime()) / 86_400_000);
    if (diffDays >= 0 && diffDays < 7) return diffDays;
    return -1;
  }, [monday, now]);

  const totalPx = HOURS_VISIBLE * HOUR_PX;

  // Now line position
  const isThisWeek = todayDayIndex >= 0;
  const nowMin = now.getHours() * 60 + now.getMinutes() - HOUR_START * 60;
  const nowPx = nowMin * (HOUR_PX / 60);
  const showNowLine = isThisWeek && nowMin >= 0 && nowMin <= HOURS_VISIBLE * 60;

  return (
    <div className="space-y-3 week-print-root">
      {/* Přepínač Den / Týden / Měsíc — vždy viditelný, i ve fullscreen.
          Ve fullscreen módu chce Petr přepínat mezi pohledy v rámci rituálu. */}
      <div className="flex items-center justify-center gap-1 print:hidden">
        <a
          href={isFullscreen ? `/day/${weekStart}?naplno=1` : `/day/${weekStart}`}
          className="px-3 py-1 rounded-md text-xs font-mono text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          Den
        </a>
        <span className="px-3 py-1 rounded-md bg-white/10 text-xs font-mono">Týden</span>
        <a
          href={
            isFullscreen
              ? `/calendar/mesic/${weekStart.slice(0, 7)}?naplno=1`
              : `/calendar/mesic/${weekStart.slice(0, 7)}`
          }
          className="px-3 py-1 rounded-md text-xs font-mono text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          Měsíc
        </a>
      </div>

      {/* Hlavička */}
      <div className="flex items-center gap-2 flex-wrap">
        <a href={prevWeekHref} className="size-9 rounded-md bg-white/5 hover:bg-white/10 grid place-items-center" aria-label="Předchozí týden">
          <ChevronLeft className="size-4" />
        </a>
        <div className="flex-1">
          <h1 className="font-serif text-2xl tracking-tight">{weekRangeLabel}</h1>
          {!isThisWeek && (
            <a href={thisWeekHref} className="text-xs font-mono text-[var(--tint-sky)] hover:underline">
              ↻ tento týden
            </a>
          )}
        </div>
        <a href={nextWeekHref} className="size-9 rounded-md bg-white/5 hover:bg-white/10 grid place-items-center" aria-label="Další týden">
          <ChevronRight className="size-4" />
        </a>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs print:hidden"
          title="Vytisknout (nebo uložit jako PDF přes Cmd+P)"
        >
          <Printer className="size-3.5" /> Tisk
        </button>
        {fullscreenHref && (
          <a
            href={fullscreenHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs print:hidden"
            title="Otevřít naplno v nové záložce"
          >
            <Maximize2 className="size-3.5" /> Naplno
          </a>
        )}
        {isFullscreen && exitFullscreenHref && (
          <a
            href={exitFullscreenHref}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs print:hidden"
          >
            <X className="size-3.5" /> Zavřít naplno
          </a>
        )}
      </div>

      {/* Legenda zdrojů */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground">
        <Dot tint="sky" label="Petr" />
        <Dot tint="rose" label="partnerka" />
        <Dot tint="mint" label="syn" />
        <Dot tint="butter" label="ostatní" />
        <Dot tint="peach" label="rituál" dashed />
        <Dot tint="pink" label="výročí" />
      </div>

      {/* Týdenní mřížka */}
      <div className="glass rounded-xl p-3 overflow-x-auto">
        <div className="grid" style={{ gridTemplateColumns: `${TIME_GUTTER_PX}px repeat(7, minmax(0, 1fr))`, minWidth: 700 }}>
          {/* Header — názvy dní */}
          <div className="text-[10px] font-mono text-muted-foreground" />
          {DAY_NAMES_SHORT.map((name, i) => {
            const dayDate = new Date(monday);
            dayDate.setDate(dayDate.getDate() + i);
            const isToday = i === todayDayIndex;
            return (
              <div
                key={i}
                className={`px-2 py-1.5 text-center border-b ${
                  isToday ? "border-[oklch(72%_0.14_35)]" : "border-white/[0.06]"
                }`}
              >
                <div className={`text-[10px] uppercase font-mono tracking-wider ${isToday ? "text-[oklch(72%_0.14_35)]" : "text-muted-foreground"}`}>
                  {name}
                </div>
                <div className={`text-sm font-medium tabular ${isToday ? "text-[oklch(72%_0.14_35)]" : "text-foreground"}`}>
                  {dayDate.getDate()}.{dayDate.getMonth() + 1}.
                </div>
              </div>
            );
          })}

          {/* All-day spanning row — multi-day eventy jsou jeden vizuální blok
              napříč sloupci, ne separátní per-day badge */}
          <div className="text-[9px] font-mono text-muted-foreground/70 px-1 py-0.5 border-r border-white/[0.06]">cel.den</div>
          <div
            className="col-span-7 relative border-b border-white/[0.06]"
            style={{
              // +22px řádek pro "+X dalších"/"sbalit" tlačítko — bez něj
              // tlačítko přetékalo pod kontejner, kde ho překrývala časová
              // mřížka a nešlo na něj kliknout (Petr 2026-07-15)
              minHeight: `${visibleAllDayRows * 22 + (hiddenSpansCount > 0 || (allDayExpanded && allDayRows > ALL_DAY_VISIBLE_ROWS) ? 22 : 0) + 4}px`,
            }}
          >
            {/* Pozadí 7 sloupců (jemný separátor) */}
            <div className="absolute inset-0 grid grid-cols-7 pointer-events-none">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="border-r border-white/[0.04]" />
              ))}
            </div>
            {/* Spans */}
            {allDaySpans
              .filter((s) => s.row < visibleAllDayRows)
              .map((s) => {
                const tint = sourceTint(s.event.source);
                const colSpan = s.endCol - s.startCol + 1;
                return (
                  <button
                    key={s.event.id}
                    type="button"
                    onClick={() => setOpenId(openId === s.event.id ? null : s.event.id)}
                    className="absolute text-left rounded text-[10px] px-1.5 py-0.5 truncate transition-all hover:brightness-110"
                    style={{
                      top: `${s.row * 22 + 2}px`,
                      left: `calc(${(s.startCol / 7) * 100}% + 1px)`,
                      width: `calc(${(colSpan / 7) * 100}% - 2px)`,
                      height: "20px",
                      background: `color-mix(in oklch, var(--tint-${tint}) 22%, transparent)`,
                      border: `1px solid color-mix(in oklch, var(--tint-${tint}) 40%, transparent)`,
                      color: `color-mix(in oklch, var(--tint-${tint}) 96%, white)`,
                    }}
                    title={`${s.event.title} (${colSpan === 1 ? "1 den" : `${colSpan} dnů`})`}
                  >
                    {colSpan > 1 && <span className="opacity-50 mr-1">▸</span>}
                    {s.event.title}
                  </button>
                );
              })}
            {/* "+ X dalších" tlačítko */}
            {hiddenSpansCount > 0 && (
              <button
                type="button"
                onClick={() => setAllDayExpanded(true)}
                className="absolute z-10 text-[9px] font-mono text-muted-foreground hover:text-foreground hover:underline px-1.5"
                style={{ top: `${ALL_DAY_VISIBLE_ROWS * 22 + 2}px`, right: 4 }}
              >
                + {hiddenSpansCount} dalších
              </button>
            )}
            {allDayExpanded && hiddenSpansCount === 0 && allDayRows > ALL_DAY_VISIBLE_ROWS && (
              <button
                type="button"
                onClick={() => setAllDayExpanded(false)}
                className="absolute z-10 text-[9px] font-mono text-muted-foreground hover:text-foreground hover:underline px-1.5"
                style={{ bottom: 2, right: 4 }}
              >
                sbalit
              </button>
            )}
          </div>

          {/* Časová osa (gutter) */}
          <div className="relative" style={{ height: totalPx }}>
            {Array.from({ length: HOURS_VISIBLE + 1 }).map((_, i) => (
              <div
                key={i}
                className="absolute right-1 text-[10px] font-mono tabular text-muted-foreground/60 -translate-y-1.5"
                style={{ top: i * HOUR_PX }}
              >
                {String(HOUR_START + i).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* 7 sloupců dní (bez now čáry — ta jde napříč všemi níž) */}
          {byDay.map((d, dayIdx) => {
            const isToday = dayIdx === todayDayIndex;
            return (
              <div
                key={`col-${dayIdx}`}
                className={`relative border-r border-white/[0.06] ${
                  isToday ? "bg-white/[0.025]" : ""
                }`}
                style={{ height: totalPx }}
              >
                {/* Hodinové čáry — tlumené */}
                {Array.from({ length: HOURS_VISIBLE + 1 }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t pointer-events-none"
                    style={{
                      top: i * HOUR_PX,
                      borderColor: "color-mix(in oklch, var(--foreground) 7%, transparent)",
                    }}
                  />
                ))}

                {/* Eventy */}
                <WeekDayColumn
                  timed={d.timed}
                  hourStart={HOUR_START}
                  hourEnd={HOUR_END}
                  hourPx={HOUR_PX}
                  now={now}
                  openId={openId}
                  onSelect={(id) => setOpenId(openId === id ? null : id)}
                  onHover={handleHover}
                  onMove={handleMove}
                  onLeave={handleLeave}
                />
              </div>
            );
          })}

          {/* Now čára — NAPŘÍČ všemi sloupci. Aktuální čas je 7:21 v Po i Pá
              stejně. Zvýraznění aktuálního DNE je separate (header pondělí).
              Časový badge VLEVO (pod hodinovým popiskem v gutteru) — Petr
              chce badge na začátku čáry, ne v pravém rohu. */}
          {showNowLine && (
            <div
              className="col-span-7 relative pointer-events-none"
              style={{
                gridColumnStart: 1, // začni od gutteru aby badge byl vlevo
                gridColumnEnd: 9,
                marginTop: -totalPx,
                height: 0,
                zIndex: 50,
              }}
            >
              <div
                className="absolute"
                style={{
                  top: nowPx,
                  left: TIME_GUTTER_PX,
                  right: 0,
                  borderTop: "2px solid oklch(72% 0.14 35)",
                }}
              />
              <span
                className="absolute px-1.5 py-0 rounded text-[9px] font-mono font-bold tabular"
                style={{
                  top: `${nowPx - 8}px`,
                  left: 0,
                  background: "oklch(72% 0.14 35)",
                  color: "oklch(15% 0.02 35)",
                }}
              >
                {fmtTime(now)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Detail panel — portal-rendered fixed modal s backdrop. Portal do <body>
          aby unikl ancestor transforms/filters co by zlomily fixed positioning. */}
      {openId && mounted && (() => {
        const ev = allEvents.find((e) => e.id === openId);
        if (!ev) return null;
        const tint = sourceTint(ev.source);
        const start = new Date(ev.startsAt);
        const end = new Date(ev.endsAt);
        return createPortal((
          <div
            className="modal-overlay"
            onClick={() => setOpenId(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="modal-panel w-full max-w-md max-h-[85vh] overflow-y-auto p-5 space-y-2 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div
                    className="text-xs font-mono tabular font-semibold mb-0.5"
                    style={{ color: `var(--tint-${tint})` }}
                  >
                    {ev.allDay ? "celý den" : `${start.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "numeric" })} · ${fmtTime(start)}–${fmtTime(end)}`}
                  </div>
                  <h3 className="text-lg font-bold tracking-[-0.02em] leading-tight text-foreground">
                    {ev.title}
                  </h3>
                </div>
                <button type="button" onClick={() => setOpenId(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              </div>
              {ev.locationText && (
                <div className="text-xs flex items-center gap-1.5 text-muted-foreground">
                  <MapPin className="size-3" /> {ev.locationText}
                </div>
              )}
              {ev.prepNote && (
                <div className="text-xs text-foreground mt-1.5 px-2 py-1.5 rounded border border-border bg-accent/40">
                  {ev.prepNote}
                </div>
              )}
              {ev.source === "RITUAL" ? (
                <>
                  <div
                    className="prose-rasel text-sm leading-relaxed mt-2"
                    dangerouslySetInnerHTML={{
                      __html: marked.parse(
                        ev.description ||
                          (ritualTypeFromId(ev.id)
                            ? DEFAULT_RITUAL_TEMPLATES[ritualTypeFromId(ev.id)!]
                            : `## ${ev.title}\n\n*Text rituálu zatím není vyplněný.*`),
                      ) as string,
                    }}
                  />
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1 pt-2 mt-2 border-t border-border">
                    <Sparkles className="size-3" /> rituál
                    <a href="/settings/ritualy" className="ml-auto hover:underline">
                      upravit text →
                    </a>
                  </div>
                </>
              ) : (
                ev.description && (
                  <p className="text-xs text-foreground/85 whitespace-pre-wrap mt-2 leading-relaxed">
                    {ev.description}
                  </p>
                )
              )}
            </div>
          </div>
        ), document.body);
      })()}

      {/* Hover tooltip — portal-rendered fixed, sleduje kurzor. */}
      {hoveredId && mounted && (() => {
        const ev = allEvents.find((e) => e.id === hoveredId);
        if (!ev) return null;
        const tint = sourceTint(ev.source);
        const start = new Date(ev.startsAt);
        const end = new Date(ev.endsAt);
        const fallbackText =
          ev.source === "RITUAL"
            ? ritualTypeFromId(ev.id)
              ? DEFAULT_RITUAL_TEMPLATES[ritualTypeFromId(ev.id)!]
              : `## ${ev.title}\n\n*Text rituálu zatím není vyplněný.*`
            : "";
        const desc = ev.description || fallbackText;
        // Tooltip se umístí 14px vpravo dolů od kurzoru. Pokud by přesahoval
        // viewport, clamp na opačné straně.
        const TOOLTIP_W = 360;
        const TOOLTIP_MAX_H = 320;
        const wouldOverflowRight = hoverPos.x + 14 + TOOLTIP_W > window.innerWidth - 8;
        const left = wouldOverflowRight
          ? Math.max(8, hoverPos.x - 14 - TOOLTIP_W)
          : hoverPos.x + 14;
        const top = Math.min(hoverPos.y + 14, window.innerHeight - TOOLTIP_MAX_H - 8);
        return createPortal((
          <div
            className="fixed pointer-events-none z-[100] print:hidden"
            style={{
              left: `${left}px`,
              top: `${Math.max(8, top)}px`,
              width: `${TOOLTIP_W}px`,
              animation: "fadeIn 120ms ease-out",
            }}
          >
            <div className="modal-panel rounded-lg p-3">
              <div
                className="text-[10px] uppercase tracking-wider font-mono mb-1 font-semibold"
                style={{ color: `var(--tint-${tint})` }}
              >
                {ev.allDay ? "celý den" : `${fmtTime(start)}–${fmtTime(end)}`}
              </div>
              <div className="text-base font-bold tracking-[-0.02em] leading-tight mb-2 text-foreground">
                {ev.title}
              </div>
              {ev.locationText && (
                <div className="text-xs flex items-center gap-1.5 text-muted-foreground mb-1">
                  <MapPin className="size-3" /> {ev.locationText}
                </div>
              )}
              {desc && (
                <div
                  className="prose-rasel text-xs leading-relaxed mt-2 max-h-[280px] overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: marked.parse(desc) as string }}
                />
              )}
            </div>
          </div>
        ), document.body);
      })()}

      {/* Interpretační lišta */}
      <div className="glass rounded-xl p-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono mb-2">
          Interpretace týdne
        </div>
        <ul className="space-y-1.5 text-sm">
          {interpretation.map((line, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-muted-foreground mt-1">·</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Úkoly tento týden — pod kalendářovým gridem (NOVÉ 2026-05-10).
          Plochý seznam Tasků s dueAt v aktuálním týdnu, výška karty úměrná
          t-* tagu. Read-only review, klik vede na /ukoly. */}
      <WeekTasksList weekStart={weekStart} tasks={weekTasks} />
    </div>
  );
}

// =============================================================================
// Sloupec dne — interval scheduling pro overlap, render bloků
// =============================================================================
function WeekDayColumn({
  timed,
  hourStart,
  hourEnd,
  hourPx,
  now,
  openId,
  onSelect,
  onHover,
  onMove,
  onLeave,
}: {
  timed: CalEvent[];
  hourStart: number;
  hourEnd: number;
  hourPx: number;
  now: Date;
  openId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string, mouseX: number, mouseY: number) => void;
  onMove: (mouseX: number, mouseY: number) => void;
  onLeave: () => void;
}) {
  const minPx = hourPx / 60;
  const totalMin = (hourEnd - hourStart) * 60;

  // Detekce long events s overlap (>3h, threshold 180)
  const longIds = new Set<string>(
    timed
      .filter((e) => (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 60_000 > 180)
      .map((e) => e.id),
  );
  const bgIds = new Set<string>();
  for (const long of timed.filter((e) => longIds.has(e.id))) {
    const ls = new Date(long.startsAt).getTime();
    const le = new Date(long.endsAt).getTime();
    if (
      timed.some(
        (other) =>
          other.id !== long.id &&
          !longIds.has(other.id) &&
          new Date(other.startsAt).getTime() < le &&
          new Date(other.endsAt).getTime() > ls,
      )
    ) {
      bgIds.add(long.id);
    }
  }
  // RITUÁLY mají vždy plnou šířku sloupce — vyloučit z column scheduleru.
  // Renderují se jako pozadí (z-index 0), klasické eventy se vykreslí přes
  // ně (z-index 1+). Tím se Petrův Ranní pohled na den zobrazí na plnou
  // šířku ve VŠECH dnech, ne jen v některých kde scheduler dal sloupec.
  const ritualEvents = timed.filter((e) => e.source === "RITUAL" && !bgIds.has(e.id));
  const fg = timed.filter((e) => !bgIds.has(e.id) && e.source !== "RITUAL");
  const bg = timed.filter((e) => bgIds.has(e.id));

  // Cluster-based column assignment — clusters jsou souvislé řetězce overlapů.
  // Pro každý cluster spočítáme totalColumns = max paralelních eventů uvnitř.
  // Solo eventy (1 event v clusteru) mají total=1 = plná šířka. Předchozí
  // verze používala globální cols.length což bralo všem eventům dne stejnou
  // úzkou šířku jakmile někde v dni byl cluster s 2+ paralelními.
  const sorted = [...fg].sort(
    (a, b) =>
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
      new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime(),
  );
  const colMap = new Map<string, { col: number; total: number }>();
  let cluster: typeof sorted = [];
  let clusterEnd = 0;

  function assignCluster(events: typeof sorted) {
    if (events.length === 0) return;
    const colEnds: number[] = [];
    const cols: number[] = [];
    for (const ev of events) {
      const s = new Date(ev.startsAt).getTime();
      let col = colEnds.findIndex((end) => end <= s);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(0);
      }
      colEnds[col] = new Date(ev.endsAt).getTime();
      cols.push(col);
    }
    const total = colEnds.length;
    events.forEach((ev, i) => {
      colMap.set(ev.id, { col: cols[i], total });
    });
  }

  for (const ev of sorted) {
    const s = new Date(ev.startsAt).getTime();
    const e = new Date(ev.endsAt).getTime();
    if (cluster.length === 0 || s < clusterEnd) {
      cluster.push(ev);
      if (e > clusterEnd) clusterEnd = e;
    } else {
      assignCluster(cluster);
      cluster = [ev];
      clusterEnd = e;
    }
  }
  assignCluster(cluster);

  function blockTopHeight(e: CalEvent) {
    const s = new Date(e.startsAt);
    const en = new Date(e.endsAt);
    // Adjust k hourStart
    const sMin = s.getHours() * 60 + s.getMinutes() - hourStart * 60;
    const eMin = en.getHours() * 60 + en.getMinutes() - hourStart * 60;
    // Pokud event přesahuje den (např. začne 1 den předem nebo skončí další), clampneme na okno
    const clampedStart = Math.max(0, sMin);
    const clampedEnd = Math.min(totalMin, eMin);
    return {
      top: clampedStart * minPx,
      height: Math.max(14, (clampedEnd - clampedStart) * minPx - 1),
    };
  }

  return (
    <>
      {/* RITUÁLY — full width, peach + dashed, ve spodní vrstvě (z-index 0).
          Klasické eventy se vykreslí přes ně, pokud overlapují. */}
      {ritualEvents.map((e) => {
        const tint = sourceTint(e.source);
        const { top, height } = blockTopHeight(e);
        const isOpen = openId === e.id;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onSelect(e.id)}
            onMouseEnter={(ev) => onHover(e.id, ev.clientX, ev.clientY)}
            onMouseMove={(ev) => onMove(ev.clientX, ev.clientY)}
            onMouseLeave={onLeave}
            className="absolute rounded text-left transition-all hover:brightness-110"
            style={{
              top,
              height,
              left: 1,
              right: 1,
              zIndex: 0,
              background: `color-mix(in oklch, var(--tint-${tint}) 18%, transparent)`,
              border: `1px dashed color-mix(in oklch, var(--tint-${tint}) 60%, transparent)`,
              boxShadow: isOpen
                ? `0 0 0 2px color-mix(in oklch, var(--tint-${tint}) 65%, transparent)`
                : undefined,
            }}
          >
            <div className="h-full overflow-hidden flex flex-col items-stretch px-1.5 pt-1">
              <div className="font-mono tabular font-semibold leading-none opacity-90 text-[9px]">
                {fmtTime(new Date(e.startsAt))}–{fmtTime(new Date(e.endsAt))}
              </div>
              <div
                className="font-medium leading-tight text-[10px] line-clamp-2"
                style={{ color: `color-mix(in oklch, var(--tint-${tint}) 96%, white)` }}
              >
                {e.title}
              </div>
            </div>
            <span className="absolute top-0.5 right-0.5 text-[var(--tint-peach)]">
              <Sparkles className="size-2.5" />
            </span>
          </button>
        );
      })}

      {/* BG eventy (long) v levé polovině */}
      {bg.map((e) => {
        const tint = sourceTint(e.source);
        const { top, height } = blockTopHeight(e);
        const dur = (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 3_600_000;
        const isOpen = openId === e.id;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onSelect(e.id)}
            className="absolute rounded text-left transition-all hover:brightness-110"
            style={{
              top,
              height,
              left: 1,
              width: "calc(50% - 2px)",
              background: `color-mix(in oklch, var(--tint-${tint}) 16%, transparent)`,
              border: `1px dashed color-mix(in oklch, var(--tint-${tint}) 35%, transparent)`,
              opacity: 0.55,
              boxShadow: isOpen ? `0 0 0 2px color-mix(in oklch, var(--tint-${tint}) 50%, transparent)` : undefined,
            }}
          >
            <div className="h-full flex flex-col justify-between px-1.5 py-1">
              <div className="space-y-0.5">
                <div className="text-[9px] font-mono tabular font-semibold opacity-80">
                  {fmtTime(new Date(e.startsAt))}–{fmtTime(new Date(e.endsAt))}
                </div>
                <div className="text-[10px] font-medium leading-tight line-clamp-2" style={{ color: `color-mix(in oklch, var(--tint-${tint}) 96%, white)` }}>
                  {e.title}
                </div>
              </div>
              {dur > 2 && (
                <div className="text-[8px] font-mono uppercase opacity-60 leading-none">
                  {Math.round(dur)} h
                </div>
              )}
            </div>
          </button>
        );
      })}

      {/* FG eventy ve sloupcích */}
      {fg.map((e) => {
        const tint = sourceTint(e.source);
        const isRitual = e.source === "RITUAL";
        const { top, height } = blockTopHeight(e);
        const isOpen = openId === e.id;
        const colInfo = colMap.get(e.id) ?? { col: 0, total: 1 };

        const overlapsBg = bg.some(
          (b) =>
            new Date(b.startsAt).getTime() < new Date(e.endsAt).getTime() &&
            new Date(b.endsAt).getTime() > new Date(e.startsAt).getTime(),
        );
        const fgLeft = overlapsBg ? 50 : 0;
        const fgWidth = (100 - fgLeft) / colInfo.total;
        const left = `calc(${fgLeft + colInfo.col * fgWidth}% + 1px)`;
        const width = `calc(${fgWidth}% - 2px)`;
        const isShort = height < 30;
        // Minulé eventy (skončily před teď) ztlumit
        const isPast = new Date(e.endsAt).getTime() < now.getTime();

        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onSelect(e.id)}
            onMouseEnter={(ev) => onHover(e.id, ev.clientX, ev.clientY)}
            onMouseMove={(ev) => onMove(ev.clientX, ev.clientY)}
            onMouseLeave={onLeave}
            className="absolute rounded text-left transition-all hover:brightness-110 active:scale-[0.99]"
            style={{
              top,
              height,
              left,
              width,
              zIndex: 1,
              opacity: isPast ? 0.45 : 1,
              background: `color-mix(in oklch, var(--tint-${tint}) ${isRitual ? 18 : 28}%, transparent)`,
              border: isRitual
                ? `1px dashed color-mix(in oklch, var(--tint-${tint}) 60%, transparent)`
                : `1px solid color-mix(in oklch, var(--tint-${tint}) 50%, transparent)`,
              boxShadow: isOpen ? `0 0 0 2px color-mix(in oklch, var(--tint-${tint}) 65%, transparent)` : undefined,
            }}
          >
            <div className={`h-full overflow-hidden flex flex-col items-stretch ${isShort ? "px-1 pt-0.5" : "px-1.5 pt-1"}`}>
              <div className={`font-mono tabular font-semibold leading-none opacity-90 ${isShort ? "text-[8px]" : "text-[9px]"}`}>
                {fmtTime(new Date(e.startsAt))}
                {!isShort && `–${fmtTime(new Date(e.endsAt))}`}
              </div>
              <div
                className={`font-medium leading-tight ${isShort ? "text-[9px] truncate" : "text-[10px] line-clamp-2"}`}
                style={{ color: `color-mix(in oklch, var(--tint-${tint}) 96%, white)` }}
              >
                {e.title}
              </div>
            </div>
            {isRitual && (
              <span className="absolute top-0.5 right-0.5 text-[var(--tint-peach)]">
                <Sparkles className="size-2.5" />
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

function Dot({ tint, label, dashed }: { tint: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block size-2 rounded-sm"
        style={{
          background: `color-mix(in oklch, var(--tint-${tint}) 50%, transparent)`,
          border: dashed
            ? `1px dashed color-mix(in oklch, var(--tint-${tint}) 70%, transparent)`
            : undefined,
        }}
      />
      {label}
    </span>
  );
}
