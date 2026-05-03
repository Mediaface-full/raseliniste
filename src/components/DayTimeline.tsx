/**
 * Vertikální timeline pro DayView (mobilní zobrazení dne).
 *
 * Důvod existence: Petr má ADHD + CPTSD + time blindness (Russell Barkley).
 * Textový seznam událostí mu nepomáhá — potřebuje čas vidět jako PROSTOR,
 * ne jako řádky. Bloky odpovídají době, barvy typu, čára teď ukazuje pozici
 * v dni.
 *
 * Wabi-sabi: tlumené pastely, papírový pocit, jemné rohy, žádné neonové.
 * Tmavý režim — barvy přes oklch tinty, čitelné ale klidné.
 *
 * Long-event handling: pokud event > 4h a překrývá kratší → kreslíme ho jako
 * background s opacitou, kratší události jdou nad něj v plné barvě.
 */
import { useEffect, useState, useMemo } from "react";
import { MapPin, Clock, X } from "lucide-react";

interface CalendarEvent {
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

// Mapování typu události na pastel tint v Rašeliništi.
// Volba: schůzky modro-šedé (sky), rodina/syn mint, partnerka růže, OOO máslové.
function eventTint(type: string): string {
  switch (type) {
    case "MEETING_PRAGUE":
    case "MEETING_HOME":
    case "MEETING_ELSEWHERE":
    case "MEETING_ONLINE":
      return "sky";
    case "PERSONAL":
      return "lavender";
    case "HOCKEY_SON":
      return "mint";
    case "PARTNER_SHIFT":
      return "rose";
    case "PARTNER_VACATION":
      return "pink";
    case "OOO_FULL":
      return "butter";
    case "OOO_TRAVEL_WORKING":
      return "peach";
    default:
      return "sage";
  }
}

function sourceLabel(src: string): string {
  if (src === "ICLOUD_SON") return "syn";
  if (src === "ICLOUD_PARTNER") return "partner";
  if (src === "RASELINISTE") return "R";
  return "G";
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false });
}

const HOUR_PX = 64; // px per hour — kompaktní ale čitelné
const MIN_PX = HOUR_PX / 60;

export default function DayTimeline({
  events,
  date,
}: {
  events: CalendarEvent[];
  date: string; // YYYY-MM-DD
}) {
  const [now, setNow] = useState(() => new Date());
  const [openId, setOpenId] = useState<string | null>(null);

  // Update aktuálního času každou minutu — čára teď se posouvá v reálu.
  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = setInterval(tick, 60_000);
    // Hned aktualizuj při návratu na tab
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const dayStart = useMemo(() => new Date(`${date}T00:00:00`), [date]);
  const dayEnd = useMemo(() => {
    const d = new Date(dayStart);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [dayStart]);
  const isToday = useMemo(() => {
    const today = new Date();
    return (
      today.getFullYear() === dayStart.getFullYear() &&
      today.getMonth() === dayStart.getMonth() &&
      today.getDate() === dayStart.getDate()
    );
  }, [dayStart, now]);

  // Filtruj jen časované eventy (allDay rendrujeme zvlášť nahoře)
  const timedEvents = events.filter((e) => !e.allDay);
  const allDayEvents = events.filter((e) => e.allDay);

  // Pokud žádné časované eventy, fallback na "celý den 8-20"
  const earliestStart = timedEvents.length > 0
    ? Math.min(...timedEvents.map((e) => new Date(e.startsAt).getTime()))
    : new Date(`${date}T08:00:00`).getTime();
  const latestEnd = timedEvents.length > 0
    ? Math.max(...timedEvents.map((e) => new Date(e.endsAt).getTime()))
    : new Date(`${date}T20:00:00`).getTime();

  // Window timeline: 1h před nejdřívější a 1h po nejpozdější.
  // Pokud je dnešek a aktuální čas spadá do okna, garantuj že now bude vidět.
  let windowStart = new Date(earliestStart - 60 * 60 * 1000);
  let windowEnd = new Date(latestEnd + 60 * 60 * 1000);
  if (windowStart < dayStart) windowStart = dayStart;
  if (windowEnd > dayEnd) windowEnd = dayEnd;
  if (isToday) {
    if (now > windowEnd) windowEnd = new Date(now.getTime() + 60 * 60 * 1000);
    if (now < windowStart) windowStart = new Date(now.getTime() - 30 * 60 * 1000);
  }

  // Zaokrouhli na celé hodiny pro hezkou mřížku
  const gridStart = new Date(windowStart);
  gridStart.setMinutes(0, 0, 0);
  const gridEnd = new Date(windowEnd);
  if (gridEnd.getMinutes() > 0 || gridEnd.getSeconds() > 0) {
    gridEnd.setHours(gridEnd.getHours() + 1, 0, 0, 0);
  }

  const totalMin = Math.max(60, (gridEnd.getTime() - gridStart.getTime()) / 60_000);
  const totalPx = totalMin * MIN_PX;

  // Generuj hodinové popisky
  const hourLabels: Array<{ label: string; topPx: number }> = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const minFromStart = (cursor.getTime() - gridStart.getTime()) / 60_000;
    hourLabels.push({
      label: cursor.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false }),
      topPx: minFromStart * MIN_PX,
    });
    cursor.setHours(cursor.getHours() + 1);
  }

  // Pro každý event spočítej pozici v px + tint
  type Layout = {
    e: CalendarEvent;
    topPx: number;
    heightPx: number;
    durationMin: number;
    tint: string;
    isLong: boolean; // > 4 hodin
  };
  const layouts: Layout[] = timedEvents.map((e) => {
    const start = new Date(e.startsAt);
    const end = new Date(e.endsAt);
    const startMin = Math.max(0, (start.getTime() - gridStart.getTime()) / 60_000);
    const endMin = Math.min(totalMin, (end.getTime() - gridStart.getTime()) / 60_000);
    const durationMin = (end.getTime() - start.getTime()) / 60_000;
    return {
      e,
      topPx: startMin * MIN_PX,
      heightPx: Math.max(20, (endMin - startMin) * MIN_PX),
      durationMin,
      tint: eventTint(e.type),
      isLong: durationMin > 240, // 4h
    };
  });

  // Detekce overlap — long event je background, krátké přes něj
  // Algoritmus: pro každý long zjisti jestli má překryv s kratším.
  const longEventIds = new Set<string>();
  for (const a of layouts) {
    if (!a.isLong) continue;
    const overlaps = layouts.some(
      (b) =>
        b.e.id !== a.e.id &&
        !b.isLong &&
        new Date(b.e.startsAt).getTime() < new Date(a.e.endsAt).getTime() &&
        new Date(b.e.endsAt).getTime() > new Date(a.e.startsAt).getTime(),
    );
    if (overlaps) longEventIds.add(a.e.id);
  }

  // "Now" pozice
  const nowMin = (now.getTime() - gridStart.getTime()) / 60_000;
  const nowPx = nowMin * MIN_PX;
  const showNow = isToday && nowMin >= 0 && nowMin <= totalMin;

  return (
    <section className="glass rounded-xl p-4" style={{ ["--c" as string]: "var(--tint-sky)" }}>
      <div className="flex items-center gap-2 mb-3">
        <Clock className="size-4" style={{ color: "var(--c)" }} />
        <h2 className="font-serif text-lg">Plán</h2>
        <span className="ml-auto text-xs font-mono text-muted-foreground">
          {events.length} {events.length === 1 ? "událost" : "události"}
        </span>
      </div>

      {/* All-day události — proužky nad osou */}
      {allDayEvents.length > 0 && (
        <div className="space-y-1 mb-3">
          {allDayEvents.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setOpenId(openId === e.id ? null : e.id)}
              className="w-full text-left rounded-md px-2.5 py-1.5 text-xs flex items-center gap-2 transition-colors"
              style={{
                background: `color-mix(in oklch, var(--tint-${eventTint(e.type)}) 14%, transparent)`,
                border: `1px solid color-mix(in oklch, var(--tint-${eventTint(e.type)}) 30%, transparent)`,
                color: `color-mix(in oklch, var(--tint-${eventTint(e.type)}) 90%, white)`,
              }}
            >
              <span className="text-[9px] font-mono uppercase tracking-wider opacity-70">celý den</span>
              <span className="flex-1 truncate text-foreground">{e.title}</span>
              <span className="text-[9px] font-mono opacity-60">{sourceLabel(e.source)}</span>
            </button>
          ))}
        </div>
      )}

      {timedEvents.length === 0 && allDayEvents.length === 0 && (
        <div className="text-sm text-muted-foreground italic py-4 text-center">
          Žádné události — užij si volno.
        </div>
      )}

      {/* Vertikální timeline */}
      {timedEvents.length > 0 && (
        <div className="relative" style={{ height: `${totalPx}px` }}>
          {/* Hodinové čáry + popisky */}
          {hourLabels.map((h, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 flex items-start"
              style={{ top: `${h.topPx}px` }}
            >
              <span className="text-[10px] font-mono text-muted-foreground/70 w-12 -translate-y-1.5 tabular shrink-0">
                {h.label}
              </span>
              <div className="flex-1 border-t border-white/[0.06]" />
            </div>
          ))}

          {/* Long event jako background (pokud overlapuje s kratším) */}
          {layouts
            .filter((l) => longEventIds.has(l.e.id))
            .map((l) => (
              <button
                key={`bg-${l.e.id}`}
                type="button"
                onClick={() => setOpenId(openId === l.e.id ? null : l.e.id)}
                className="absolute left-12 right-0 rounded-lg overflow-hidden text-left transition-all"
                style={{
                  top: `${l.topPx}px`,
                  height: `${l.heightPx}px`,
                  background: `color-mix(in oklch, var(--tint-${l.tint}) 12%, transparent)`,
                  border: `1px dashed color-mix(in oklch, var(--tint-${l.tint}) 35%, transparent)`,
                }}
              >
                <div className="px-3 py-1.5 flex items-start gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider opacity-50 mt-0.5">
                    {Math.round(l.durationMin / 60)} h
                  </span>
                  <span
                    className="text-sm flex-1 truncate"
                    style={{ color: `color-mix(in oklch, var(--tint-${l.tint}) 95%, white)` }}
                  >
                    {l.e.title}
                  </span>
                </div>
              </button>
            ))}

          {/* Krátké eventy + non-overlapping long eventy v plné barvě */}
          {layouts
            .filter((l) => !longEventIds.has(l.e.id))
            .map((l) => {
              const isOpen = openId === l.e.id;
              const showFullLabel = l.heightPx >= 28;
              const showLocation = l.heightPx >= 56 && l.e.locationText;
              return (
                <button
                  key={l.e.id}
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : l.e.id)}
                  className="absolute left-12 right-0 rounded-lg overflow-hidden text-left transition-all hover:brightness-110 active:scale-[0.99]"
                  style={{
                    top: `${l.topPx}px`,
                    height: `${l.heightPx}px`,
                    background: `color-mix(in oklch, var(--tint-${l.tint}) 22%, transparent)`,
                    border: `1px solid color-mix(in oklch, var(--tint-${l.tint}) 45%, transparent)`,
                    boxShadow: isOpen
                      ? `0 0 0 2px color-mix(in oklch, var(--tint-${l.tint}) 60%, transparent)`
                      : undefined,
                  }}
                >
                  <div className="px-2.5 py-1 h-full flex flex-col justify-start gap-0.5">
                    <div className="flex items-start gap-1.5">
                      <span
                        className="text-sm font-medium leading-tight flex-1 truncate"
                        style={{ color: `color-mix(in oklch, var(--tint-${l.tint}) 96%, white)` }}
                      >
                        {l.e.title}
                      </span>
                      <span className="text-[9px] font-mono opacity-50 shrink-0 mt-0.5">
                        {sourceLabel(l.e.source)}
                      </span>
                    </div>
                    {showFullLabel && (
                      <div className="text-[10px] font-mono text-muted-foreground tabular leading-tight">
                        {fmtTime(new Date(l.e.startsAt))}–{fmtTime(new Date(l.e.endsAt))}
                      </div>
                    )}
                    {showLocation && (
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1 truncate leading-tight">
                        <MapPin className="size-2.5 shrink-0" />
                        <span className="truncate">{l.e.locationText}</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}

          {/* Čára aktuálního času */}
          {showNow && (
            <div
              className="absolute left-0 right-0 pointer-events-none z-10"
              style={{ top: `${nowPx}px` }}
            >
              <div className="flex items-center">
                <span className="text-[10px] font-mono font-bold text-[var(--tint-rose)] w-12 -translate-y-2 tabular shrink-0">
                  {fmtTime(now)}
                </span>
                <div className="flex-1 flex items-center">
                  <div className="size-2 rounded-full bg-[var(--tint-rose)] -translate-y-[3px]" />
                  <div className="flex-1 border-t-2 border-[var(--tint-rose)]" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail vybrané události — bottom sheet style, mobilní friendly */}
      {openId && (() => {
        const ev = events.find((e) => e.id === openId);
        if (!ev) return null;
        const tint = eventTint(ev.type);
        const start = new Date(ev.startsAt);
        const end = new Date(ev.endsAt);
        return (
          <div
            className="mt-4 rounded-lg p-4 space-y-2 text-sm"
            style={{
              background: `color-mix(in oklch, var(--tint-${tint}) 10%, transparent)`,
              border: `1px solid color-mix(in oklch, var(--tint-${tint}) 30%, transparent)`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <h3
                className="font-serif text-lg leading-tight"
                style={{ color: `color-mix(in oklch, var(--tint-${tint}) 96%, white)` }}
              >
                {ev.title}
              </h3>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Zavřít detail"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="text-xs font-mono text-muted-foreground tabular flex flex-wrap gap-x-3 gap-y-1">
              <span>
                {ev.allDay ? "celý den" : `${fmtTime(start)}–${fmtTime(end)}`}
              </span>
              <span>·</span>
              <span>{sourceLabel(ev.source)}</span>
              <span>·</span>
              <span>{ev.type.toLowerCase().replace(/_/g, " ")}</span>
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
          </div>
        );
      })()}
    </section>
  );
}
