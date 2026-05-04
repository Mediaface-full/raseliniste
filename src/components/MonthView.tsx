/**
 * Měsíční pohled — orientační, nikoli plánovací.
 *
 * Pravidla:
 * - Žádné texty v denních buňkách
 * - Hustota podbarvení podle počtu eventů: 0/1-2/3-4/5+
 * - "Velké" eventy (allDay nebo >4h) = drobná tečka v rohu, barva = source
 * - Aktuální den: jasný terakotový rámeček
 * - Aktuální týden: jemně podbarvený řádek
 * - Klik na buňku → /day/<datum>
 */
import { Maximize2, X, Printer } from "lucide-react";

interface BasicEvent {
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  title: string;
  source: string;
}

interface DayCell {
  date: string; // YYYY-MM-DD
  dayOfMonth: number;
  isCurrentMonth: boolean;
  count: number;
  bigEvents: { source: string; title: string }[];
}

interface Props {
  monthStart: string; // YYYY-MM-DD = 1. den měsíce
  cells: DayCell[]; // 6 týdnů × 7 = 42 buněk
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
  if (src === "ICLOUD_PARTNER") return "rose";
  if (src === "ICLOUD_SON") return "mint";
  if (src === "GOOGLE_PRIMARY") return "sky";
  return "butter";
}

function densityClass(count: number): { bg: string; opacity: number } {
  if (count === 0) return { bg: "transparent", opacity: 0 };
  if (count <= 2) return { bg: "var(--foreground)", opacity: 0.05 };
  if (count <= 4) return { bg: "var(--foreground)", opacity: 0.1 };
  return { bg: "var(--foreground)", opacity: 0.18 };
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
  // Najdi index týdne, který obsahuje dnešek (pro subtle podbarvení řádku)
  let currentWeekIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].date === todayIso) {
      currentWeekIdx = Math.floor(i / 7);
      break;
    }
  }

  // ISO datum 1. dne aktuálního měsíce — pro link na týdenní/denní pohled
  const ymStart = monthStart;
  return (
    <div className="space-y-3 month-print-root">
      {/* Přepínač Den / Týden / Měsíc — vždy viditelný (i ve fullscreen) */}
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
        <a href={prevMonthHref} className="size-9 rounded-md bg-white/5 hover:bg-white/10 grid place-items-center" aria-label="Předchozí měsíc">
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
        <a href={nextMonthHref} className="size-9 rounded-md bg-white/5 hover:bg-white/10 grid place-items-center" aria-label="Další měsíc">
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

      {/* Mřížka */}
      <div className="glass rounded-xl p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAY_NAMES.map((name) => (
            <div key={name} className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-center py-1">
              {name}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, i) => {
            const weekIdx = Math.floor(i / 7);
            const inCurrentWeek = weekIdx === currentWeekIdx;
            const isToday = cell.date === todayIso;
            const dens = densityClass(cell.count);
            return (
              <a
                key={cell.date}
                href={`/day/${cell.date}`}
                title={`${cell.date} · ${cell.count} ${cell.count === 1 ? "událost" : cell.count >= 2 && cell.count <= 4 ? "události" : "událostí"}${cell.bigEvents.length > 0 ? "\n\nVelké: " + cell.bigEvents.map((b) => b.title).join(", ") : ""}`}
                className={`relative aspect-square rounded-md flex items-start justify-end p-1.5 transition-all hover:brightness-125 ${
                  cell.isCurrentMonth ? "" : "opacity-30"
                }`}
                style={{
                  background: `color-mix(in oklch, ${dens.bg} ${dens.opacity * 100}%, transparent)`,
                  border: isToday
                    ? "1.5px solid oklch(72% 0.14 35)"
                    : inCurrentWeek
                      ? "1px solid color-mix(in oklch, var(--foreground) 6%, transparent)"
                      : "1px solid transparent",
                  boxShadow: inCurrentWeek && !isToday
                    ? "inset 0 0 0 9999px color-mix(in oklch, var(--foreground) 2%, transparent)"
                    : undefined,
                }}
              >
                <span
                  className={`text-xs font-mono tabular ${
                    isToday ? "text-[oklch(72%_0.14_35)] font-bold" : "text-foreground/80"
                  }`}
                >
                  {cell.dayOfMonth}
                </span>
                {/* Tečky pro velké eventy */}
                {cell.bigEvents.length > 0 && (
                  <div className="absolute bottom-1 left-1 flex gap-0.5">
                    {cell.bigEvents.slice(0, 4).map((b, idx) => (
                      <span
                        key={idx}
                        className="size-1.5 rounded-full"
                        style={{ background: `var(--tint-${sourceTint(b.source)})` }}
                      />
                    ))}
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
          { c: 1, label: "1-2" },
          { c: 3, label: "3-4" },
          { c: 5, label: "5+" },
        ].map((s) => {
          const d = densityClass(s.c);
          return (
            <span key={s.c} className="inline-flex items-center gap-1">
              <span
                className="inline-block size-3 rounded-sm border border-white/10"
                style={{ background: `color-mix(in oklch, ${d.bg} ${d.opacity * 100}%, transparent)` }}
              />
              {s.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
