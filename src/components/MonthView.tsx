/**
 * Měsíční pohled — orientační. Petr otevře, na první pohled vidí:
 *  - Kde v měsíci je (zvýrazněný den + aktuální týden)
 *  - Které dny jsou hektické a které volné (hustotní podbarvení)
 *  - Které dny mají velké události (text v buňce, source-color)
 *  - Co celý měsíc znamená (interpretační lišta)
 *
 * Hover na buňku → tooltip se seznamem všech událostí daného dne.
 * Klik na buňku → /day/<datum>.
 */
import { useState, useRef } from "react";
import { Maximize2, X, Printer, Sparkles } from "lucide-react";

interface DayEvent {
  title: string;
  source: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
}

interface DayCell {
  date: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  count: number;
  bigEvents: { source: string; title: string; allDay: boolean }[];
  allEvents: DayEvent[];
  hasRitual: boolean;
}

interface Props {
  monthStart: string;
  cells: DayCell[];
  prevMonthHref: string;
  nextMonthHref: string;
  thisMonthHref: string;
  monthLabel: string;
  todayIso: string;
  interpretation: string[];
  fullscreenHref?: string;
  isFullscreen?: boolean;
  exitFullscreenHref?: string;
}

const DAY_NAMES = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

function sourceTint(src: string): string {
  if (src === "RITUAL") return "peach";
  if (src === "ANNIVERSARY") return "pink";
  if (src === "ICLOUD_PARTNER") return "rose";
  if (src === "ICLOUD_SON") return "mint";
  if (src === "GOOGLE_PRIMARY") return "sky";
  return "butter";
}

/**
 * Hustotní podbarvení — 5 stupňů. Klient na první pohled vidí "tady budou
 * hektické dny, tady volné". Nejtmavší = varovný signál.
 */
function densityStyle(count: number): { bg: string; opacity: number } {
  if (count === 0) return { bg: "transparent", opacity: 0 };
  if (count === 1) return { bg: "var(--foreground)", opacity: 0.04 };
  if (count <= 3) return { bg: "var(--foreground)", opacity: 0.09 };
  if (count <= 5) return { bg: "var(--foreground)", opacity: 0.16 };
  return { bg: "var(--tint-rose)", opacity: 0.18 }; // 6+ = rose tint, varovný
}

export default function MonthView({
  monthStart,
  cells,
  prevMonthHref,
  nextMonthHref,
  thisMonthHref,
  monthLabel,
  todayIso,
  interpretation,
  fullscreenHref,
  isFullscreen,
  exitFullscreenHref,
}: Props) {
  const ymStart = monthStart;

  // Najdi index týdne s dneškem (pro subtle podbarvení řádku)
  let currentWeekIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].date === todayIso) {
      currentWeekIdx = Math.floor(i / 7);
      break;
    }
  }

  // Hover tooltip state
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number; align: "left" | "right" }>({
    x: 0,
    y: 0,
    align: "right",
  });
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleMouseEnter(e: React.MouseEvent<HTMLAnchorElement>, date: string) {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    const rect = e.currentTarget.getBoundingClientRect();
    const middle = window.innerWidth / 2;
    const align: "left" | "right" = rect.left + rect.width / 2 > middle ? "left" : "right";
    setHoverPos({
      x: align === "right" ? rect.right + 8 : rect.left - 8,
      y: rect.top,
      align,
    });
    // Plynulý přechod 200ms — Petr explicit
    hoverTimeoutRef.current = setTimeout(() => setHoveredDate(date), 200);
  }

  function handleMouseLeave() {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setHoveredDate(null), 100);
  }

  const hoveredCell = hoveredDate ? cells.find((c) => c.date === hoveredDate) : null;

  return (
    <div className="space-y-3 month-print-root">
      {/* Přepínač Den/Týden/Měsíc */}
      <div className="flex items-center justify-center gap-1 print:hidden">
        <a
          href={isFullscreen ? `/day/${ymStart}?naplno=1` : `/day/${ymStart}`}
          className="px-3 py-1 rounded-md text-xs font-mono text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          Den
        </a>
        <a
          href={isFullscreen ? `/calendar/tyden/${ymStart}?naplno=1` : `/calendar/tyden/${ymStart}`}
          className="px-3 py-1 rounded-md text-xs font-mono text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          Týden
        </a>
        <span className="px-3 py-1 rounded-md bg-white/10 text-xs font-mono">Měsíc</span>
      </div>

      {/* Hlavička */}
      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={prevMonthHref}
          className="size-9 rounded-md bg-white/5 hover:bg-white/10 grid place-items-center"
          aria-label="Předchozí měsíc"
        >
          ←
        </a>
        <div className="flex-1">
          <h1 className="font-serif text-2xl tracking-tight">{monthLabel}</h1>
          {currentWeekIdx === -1 && (
            <a href={thisMonthHref} className="text-xs font-mono text-[var(--tint-sky)] hover:underline">
              ↻ tento měsíc
            </a>
          )}
        </div>
        <a
          href={nextMonthHref}
          className="size-9 rounded-md bg-white/5 hover:bg-white/10 grid place-items-center"
          aria-label="Další měsíc"
        >
          →
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
        <Dot tint="peach" label="rituál" />
        <Dot tint="pink" label="výročí" />
      </div>

      {/* Mřížka */}
      <div className="glass rounded-xl p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAY_NAMES.map((name) => (
            <div
              key={name}
              className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-center py-1"
            >
              {name}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, i) => {
            const weekIdx = Math.floor(i / 7);
            const inCurrentWeek = weekIdx === currentWeekIdx;
            const isToday = cell.date === todayIso;
            const dens = densityStyle(cell.count);
            const visible = cell.bigEvents.slice(0, 2);
            const remaining = cell.count - visible.length;

            return (
              <a
                key={cell.date}
                href={`/day/${cell.date}${isFullscreen ? "?naplno=1" : ""}`}
                onMouseEnter={(e) => handleMouseEnter(e, cell.date)}
                onMouseLeave={handleMouseLeave}
                className={`relative aspect-square min-h-[80px] rounded-md flex flex-col p-1.5 transition-all hover:brightness-125 hover:scale-[1.02] ${
                  cell.isCurrentMonth ? "" : "opacity-30"
                }`}
                style={{
                  background: `color-mix(in oklch, ${dens.bg} ${dens.opacity * 100}%, transparent)`,
                  border: isToday
                    ? "1.5px solid oklch(72% 0.14 35)"
                    : inCurrentWeek
                      ? "1px solid color-mix(in oklch, var(--foreground) 8%, transparent)"
                      : "1px solid transparent",
                  boxShadow:
                    inCurrentWeek && !isToday
                      ? "inset 0 0 0 9999px color-mix(in oklch, var(--foreground) 2%, transparent)"
                      : undefined,
                }}
              >
                {/* Hlavička buňky — číslo dne + rituál tečka */}
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-mono tabular ${
                      isToday
                        ? "text-[oklch(72%_0.14_35)] font-bold"
                        : "text-foreground/85"
                    }`}
                  >
                    {cell.dayOfMonth}
                  </span>
                  {cell.hasRitual && (
                    <Sparkles
                      className="size-2.5"
                      style={{ color: "var(--tint-peach)" }}
                    />
                  )}
                </div>

                {/* Velké události jako text v buňce */}
                <div className="flex-1 mt-1 space-y-0.5 overflow-hidden">
                  {visible.map((b, idx) => {
                    const tint = sourceTint(b.source);
                    return (
                      <div
                        key={idx}
                        className="text-[10px] leading-tight truncate font-medium"
                        style={{
                          color: `color-mix(in oklch, var(--tint-${tint}) 92%, white)`,
                        }}
                        title={b.title}
                      >
                        {b.allDay && <span className="opacity-50">▸ </span>}
                        {b.title.length > 20 ? `${b.title.slice(0, 19)}…` : b.title}
                      </div>
                    );
                  })}
                </div>

                {/* "+ X dalších" pokud je víc */}
                {remaining > 0 && (
                  <div className="text-[9px] font-mono text-muted-foreground mt-0.5">
                    + {remaining} dalších
                  </div>
                )}
              </a>
            );
          })}
        </div>
      </div>

      {/* Interpretační lišta */}
      {interpretation.length > 0 && (
        <div className="glass rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono mb-2">
            Interpretace měsíce
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
      )}

      {/* Legenda hustoty */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-muted-foreground">
        <span>hustota:</span>
        {[
          { c: 0, label: "0" },
          { c: 1, label: "1" },
          { c: 2, label: "2-3" },
          { c: 4, label: "4-5" },
          { c: 6, label: "6+" },
        ].map((s) => {
          const d = densityStyle(s.c);
          return (
            <span key={s.c} className="inline-flex items-center gap-1">
              <span
                className="inline-block size-3 rounded-sm border border-white/10"
                style={{
                  background: `color-mix(in oklch, ${d.bg} ${d.opacity * 100}%, transparent)`,
                }}
              />
              {s.label}
            </span>
          );
        })}
      </div>

      {/* Hover tooltip — fixed pozice, fade-in */}
      {hoveredCell && (
        <div
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
          }}
          onMouseLeave={handleMouseLeave}
          className="fixed pointer-events-auto z-50 print:hidden"
          style={{
            left: hoverPos.align === "right" ? `${hoverPos.x}px` : undefined,
            right:
              hoverPos.align === "left"
                ? `${window.innerWidth - hoverPos.x}px`
                : undefined,
            top: `${hoverPos.y}px`,
            maxWidth: "320px",
            animation: "fadeIn 200ms ease-out",
          }}
        >
          <div
            className="glass-strong rounded-lg p-3 shadow-2xl border border-white/15"
            style={{ background: "oklch(14% 0.025 260 / 0.92)" }}
          >
            <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
              {formatLongDate(hoveredCell.date)}
            </div>
            {hoveredCell.hasRitual && (
              <div className="text-[10px] font-mono text-[var(--tint-peach)] flex items-center gap-1 mt-1">
                <Sparkles className="size-2.5" /> rituál
              </div>
            )}
            {hoveredCell.allEvents.length === 0 ? (
              <div className="text-xs italic text-muted-foreground mt-2">
                Žádné události
              </div>
            ) : (
              <ul className="mt-2 space-y-1 text-xs">
                {hoveredCell.allEvents.slice(0, 8).map((ev, i) => {
                  const tint = sourceTint(ev.source);
                  return (
                    <li key={i} className="flex items-start gap-2 leading-tight">
                      <span
                        className="font-mono tabular text-[10px] shrink-0 w-12 mt-px"
                        style={{
                          color: `color-mix(in oklch, var(--tint-${tint}) 80%, white)`,
                        }}
                      >
                        {ev.allDay
                          ? "celý den"
                          : ev.startTime ?? "—"}
                      </span>
                      <span
                        className="flex-1"
                        style={{
                          color: `color-mix(in oklch, var(--tint-${tint}) 95%, white)`,
                        }}
                      >
                        {ev.title}
                      </span>
                    </li>
                  );
                })}
                {hoveredCell.allEvents.length > 8 && (
                  <li className="text-[10px] text-muted-foreground italic">
                    + {hoveredCell.allEvents.length - 8} dalších
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatLongDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function Dot({ tint, label }: { tint: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block size-2 rounded-sm"
        style={{ background: `color-mix(in oklch, var(--tint-${tint}) 50%, transparent)` }}
      />
      {label}
    </span>
  );
}
