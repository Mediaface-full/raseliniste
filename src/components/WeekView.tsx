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
import { ChevronLeft, ChevronRight, Maximize2, MapPin, X, Sparkles } from "lucide-react";

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
}

const HOUR_START = 6;
const HOUR_END = 23;
const HOURS_VISIBLE = HOUR_END - HOUR_START; // 17
const HOUR_PX = 56;
const TIME_GUTTER_PX = 56;
const DAY_NAMES_SHORT = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

function sourceTint(src: string): string {
  if (src === "RITUAL") return "peach";
  if (src === "ICLOUD_PARTNER") return "rose";
  if (src === "ICLOUD_SON") return "mint";
  if (src === "GOOGLE_PRIMARY") return "sky";
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
}: Props) {
  const [now, setNow] = useState(() => new Date());
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, []);

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

  type ByDay = { allDay: CalEvent[]; timed: CalEvent[] };
  const byDay = useMemo<ByDay[]>(() => {
    const result: ByDay[] = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(monday);
      dayStart.setDate(dayStart.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      const dayEvents = allEvents.filter((e) => {
        const s = new Date(e.startsAt);
        const en = new Date(e.endsAt);
        // Event protíná tento den
        return en > dayStart && s <= dayEnd;
      });
      result.push({
        allDay: dayEvents.filter((e) => e.allDay),
        timed: dayEvents.filter((e) => !e.allDay),
      });
    }
    return result;
  }, [allEvents, monday]);

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
    <div className="space-y-3">
      {/* Přepínač Den / Týden / Měsíc */}
      {!isFullscreen && (
        <div className="flex items-center justify-center gap-1">
          <a
            href={`/day/${weekStart}`}
            className="px-3 py-1 rounded-md text-xs font-mono text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            Den
          </a>
          <span className="px-3 py-1 rounded-md bg-white/10 text-xs font-mono">Týden</span>
          <a
            href={`/calendar/mesic/${weekStart.slice(0, 7)}`}
            className="px-3 py-1 rounded-md text-xs font-mono text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            Měsíc
          </a>
        </div>
      )}

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
        {fullscreenHref && (
          <a
            href={fullscreenHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs"
            title="Otevřít naplno v nové záložce"
          >
            <Maximize2 className="size-3.5" /> Naplno
          </a>
        )}
        {isFullscreen && exitFullscreenHref && (
          <a
            href={exitFullscreenHref}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs"
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

          {/* All-day proužek */}
          <div className="text-[9px] font-mono text-muted-foreground/70 px-1 py-0.5 border-r border-white/[0.06]">cel.den</div>
          {byDay.map((d, i) => (
            <div key={`ad-${i}`} className="border-r border-white/[0.06] py-0.5 px-0.5 space-y-0.5 min-h-[18px]">
              {d.allDay.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setOpenId(openId === e.id ? null : e.id)}
                  className="w-full text-left rounded text-[10px] px-1 py-0.5 truncate"
                  style={{
                    background: `color-mix(in oklch, var(--tint-${sourceTint(e.source)}) 18%, transparent)`,
                    color: `color-mix(in oklch, var(--tint-${sourceTint(e.source)}) 96%, white)`,
                  }}
                  title={e.title}
                >
                  {e.title}
                </button>
              ))}
            </div>
          ))}

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

          {/* 7 sloupců dní */}
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

                {/* Eventy — render přes WeekDayColumn (interní inline) */}
                <WeekDayColumn
                  timed={d.timed}
                  hourStart={HOUR_START}
                  hourEnd={HOUR_END}
                  hourPx={HOUR_PX}
                  openId={openId}
                  onSelect={(id) => setOpenId(openId === id ? null : id)}
                />

                {/* Now čára — terakota přes celý sloupec, jen pro dnešní */}
                {showNowLine && isToday && (
                  <div
                    className="absolute left-0 right-0 pointer-events-none"
                    style={{ top: nowPx, zIndex: 50 }}
                  >
                    <div
                      style={{ borderTop: "2px solid oklch(72% 0.14 35)" }}
                    />
                    <span
                      className="absolute right-1 -top-2.5 px-1 py-0 rounded text-[9px] font-mono font-bold tabular"
                      style={{ background: "oklch(72% 0.14 35)", color: "oklch(15% 0.02 35)" }}
                    >
                      {fmtTime(now)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail panel pod mřížkou */}
      {openId && (() => {
        const ev = allEvents.find((e) => e.id === openId);
        if (!ev) return null;
        const tint = sourceTint(ev.source);
        const start = new Date(ev.startsAt);
        const end = new Date(ev.endsAt);
        return (
          <div
            className="rounded-lg p-4 space-y-2 text-sm"
            style={{
              background: `color-mix(in oklch, var(--tint-${tint}) 10%, transparent)`,
              border: `1px solid color-mix(in oklch, var(--tint-${tint}) 30%, transparent)`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-mono tabular font-semibold mb-0.5" style={{ color: `color-mix(in oklch, var(--tint-${tint}) 90%, white)` }}>
                  {ev.allDay ? "celý den" : `${start.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "numeric" })} · ${fmtTime(start)}–${fmtTime(end)}`}
                </div>
                <h3 className="font-serif text-lg leading-tight" style={{ color: `color-mix(in oklch, var(--tint-${tint}) 96%, white)` }}>
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
              <div className="text-xs text-[var(--tint-butter)] mt-1.5 px-2 py-1.5 rounded bg-black/20">
                📝 {ev.prepNote}
              </div>
            )}
            {ev.description && (
              <p className="text-xs text-muted-foreground/90 whitespace-pre-wrap mt-2 leading-relaxed">
                {ev.description}
              </p>
            )}
            {ev.source === "RITUAL" && (
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--tint-peach)] flex items-center gap-1 pt-1">
                <Sparkles className="size-3" /> rituál
              </div>
            )}
          </div>
        );
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
  openId,
  onSelect,
}: {
  timed: CalEvent[];
  hourStart: number;
  hourEnd: number;
  hourPx: number;
  openId: string | null;
  onSelect: (id: string) => void;
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
  const fg = timed.filter((e) => !bgIds.has(e.id));
  const bg = timed.filter((e) => bgIds.has(e.id));

  // Greedy column assignment pro FG events
  const sorted = [...fg].sort(
    (a, b) =>
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
      new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime(),
  );
  const cols: number[] = [];
  const colMap = new Map<string, { col: number; total: number }>();
  for (const ev of sorted) {
    const s = new Date(ev.startsAt).getTime();
    let col = cols.findIndex((end) => end <= s);
    if (col === -1) {
      col = cols.length;
      cols.push(0);
    }
    cols[col] = new Date(ev.endsAt).getTime();
    colMap.set(ev.id, { col, total: 0 });
  }
  // Set total = max columns used
  for (const v of colMap.values()) v.total = cols.length;

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

        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onSelect(e.id)}
            className="absolute rounded text-left transition-all hover:brightness-110 active:scale-[0.99]"
            title={`${fmtTime(new Date(e.startsAt))}–${fmtTime(new Date(e.endsAt))} · ${e.title}`}
            style={{
              top,
              height,
              left,
              width,
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
