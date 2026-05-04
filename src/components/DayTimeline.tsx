/**
 * Vertikální timeline pro DayView (mobilní zobrazení dne).
 *
 * Důvod existence: Petr má ADHD + CPTSD + time blindness (Russell Barkley).
 * Textový seznam událostí mu nepomáhá — potřebuje čas vidět jako PROSTOR,
 * ne jako řádky. Bloky odpovídají době, barvy podle zdroje (čí to je),
 * čára teď ukazuje pozici v dni.
 *
 * KLÍČOVÉ NÁVRHOVÉ ROZHODNUTÍ:
 *
 * 1. **Barva podle zdroje, ne typu.** Sky = Petrův kalendář, rose = partnerka,
 *    mint = syn, butter = sdílené/pracovní/RASELINISTE. Petr potřebuje rychle
 *    vidět ČÍ život se v dni odehrává.
 *
 * 2. **Překrývající události vedle sebe v sloupcích.** Žádné renderování přes
 *    sebe — interval-scheduling algoritmus (sweep) přiřadí sloupce.
 *
 * 3. **Long event (>3h) co overlapuje krátkou** = background s opacitou 40 %,
 *    krátké přes něj plně. "Celé odpoledne se něco děje, ale tady jsou
 *    konkrétní akce uvnitř." Petr to explicitně chtěl.
 *
 * 4. **Mezera 1-2 px** mezi navazujícími bloky aby splývaly.
 *
 * 5. **Now čára** v terakotě (tlumená teplá oranžová, oklch 70% 0.14 35),
 *    z-50 — přes všechno.
 *
 * 6. **Ranní hodiny ve kterých se spí** se nezobrazují. Grid začíná od
 *    first event − 1h (zaokrouhleno na hodinu).
 *
 * 7. **Čas v bloku NAD názvem** (Petr: "klient potřebuje vědět kdy, pak co").
 */
import { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { MapPin, X, ArrowUp, ArrowDown, Sparkles } from "lucide-react";
import { marked } from "marked";
import { DEFAULT_RITUAL_TEMPLATES, type RitualType } from "@/lib/week-rituals";

function ritualTypeFromId(id: string): RitualType | null {
  if (id.startsWith("ritual-morning-")) return "morning_day";
  if (id.startsWith("ritual-friday-")) return "friday_reflection";
  if (id.startsWith("ritual-sunday-")) return "weekly_review";
  return null;
}

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

// ----- Barva podle ZDROJE (ne typu) -----
// Petr potřebuje rychle vidět čí život se v dni odehrává.
// V rámci rodiny lze rozlišit typ skrze sytost — zatím jednotně.
function sourceTint(src: string): string {
  if (src === "RITUAL") return "peach";
  if (src === "ANNIVERSARY") return "pink";
  if (src === "ICLOUD_PARTNER") return "rose";
  if (src === "ICLOUD_SON") return "mint";
  if (src === "GOOGLE_PRIMARY") return "sky";
  if (src === "RASELINISTE") return "butter";
  return "butter";
}

function sourceLabel(src: string): string {
  if (src === "RITUAL") return "✨";
  if (src === "ANNIVERSARY") return "🕯";
  if (src === "ICLOUD_SON") return "syn";
  if (src === "ICLOUD_PARTNER") return "partner";
  if (src === "RASELINISTE") return "R";
  return "G";
}

function isRitual(src: string): boolean {
  return src === "RITUAL";
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false });
}

const HOUR_PX = 76; // px per hour — vyšší rozlišení, přesnější umístění minut
const MIN_PX = HOUR_PX / 60;
const LEFT_GUTTER_PX = 48; // šířka pro hodinové popisky vlevo
const BLOCK_GAP_PX = 2; // mezera mezi navazujícími bloky (jen ze SPODKU bloku)
const LONG_THRESHOLD_MIN = 180; // 3h — nad tím je event "long"

// ----- Sweep algoritmus pro přiřazení sloupců (interval scheduling) -----
type ColumnAssignment<T> = { event: T; column: number; totalColumns: number; clusterId: number };

function assignColumns<T extends { startsAt: string; endsAt: string }>(
  events: T[],
): Map<T, ColumnAssignment<T>> {
  const sorted = [...events].sort(
    (a, b) =>
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
      new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime(),
  );

  const result = new Map<T, ColumnAssignment<T>>();

  // Rozděl do clusterů — souvislých řetězců overlapů. Pro každý cluster
  // určíme totalColumns (max paralelních eventů v libovolném okamžiku).
  let clusterId = 0;
  let currentCluster: T[] = [];
  let currentClusterEnd = 0;

  for (const ev of sorted) {
    const start = new Date(ev.startsAt).getTime();
    const end = new Date(ev.endsAt).getTime();
    if (currentCluster.length === 0 || start < currentClusterEnd) {
      currentCluster.push(ev);
      if (end > currentClusterEnd) currentClusterEnd = end;
    } else {
      // Uzavři předchozí cluster a spočítej sloupce
      assignClusterColumns(currentCluster, clusterId, result);
      clusterId++;
      currentCluster = [ev];
      currentClusterEnd = end;
    }
  }
  if (currentCluster.length > 0) {
    assignClusterColumns(currentCluster, clusterId, result);
  }

  return result;
}

function assignClusterColumns<T extends { startsAt: string; endsAt: string }>(
  cluster: T[],
  clusterId: number,
  result: Map<T, ColumnAssignment<T>>,
): void {
  // Greedy: každému eventu přiřaď nejmenší volný sloupec
  // (kde žádný předchozí v tom sloupci ještě nekončí)
  const columnEnds: number[] = []; // endTime per column
  const assignments = new Map<T, number>();

  for (const ev of cluster) {
    const start = new Date(ev.startsAt).getTime();
    let assigned = -1;
    for (let i = 0; i < columnEnds.length; i++) {
      if (columnEnds[i] <= start) {
        assigned = i;
        break;
      }
    }
    if (assigned === -1) {
      assigned = columnEnds.length;
      columnEnds.push(0);
    }
    columnEnds[assigned] = new Date(ev.endsAt).getTime();
    assignments.set(ev, assigned);
  }

  const totalColumns = columnEnds.length;
  for (const [ev, col] of assignments) {
    result.set(ev, { event: ev, column: col, totalColumns, clusterId });
  }
}

export default function DayTimeline({
  events,
  date,
}: {
  events: CalendarEvent[];
  date: string; // YYYY-MM-DD
}) {
  const [now, setNow] = useState(() => new Date());
  const [openId, setOpenId] = useState<string | null>(null);
  const [nowVisibility, setNowVisibility] = useState<"in" | "above" | "below">("in");
  const [mounted, setMounted] = useState(false);
  const nowMarkerRef = useRef<HTMLDivElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Update aktuálního času každou minutu
  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = setInterval(tick, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Sleduj jestli je "now" čára vidět ve viewportu (window scroll).
  // Pokud ne, zobraz floating tlačítko "skok na teď" — Petr potřebuje vždy
  // vědět kde v dni je.
  useEffect(() => {
    const el = nowMarkerRef.current;
    if (!el) {
      setNowVisibility("in");
      return;
    }
    const update = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (rect.bottom < 80) setNowVisibility("above");
      else if (rect.top > vh - 80) setNowVisibility("below");
      else setNowVisibility("in");
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [now]);

  function scrollToNow() {
    nowMarkerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

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
    // intentionally not depend on `now` — toto je per-render boolean
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart]);

  const allDayEvents = events.filter((e) => e.allDay);
  const timedEvents = events.filter((e) => !e.allDay);

  // Dominantní zdroj — pokud má jeden source ≥ 80 % eventů, je to "default"
  // a ten badge nezobrazujeme (jen u "minoritních" zdrojů). Když je distribuce
  // smíšená, ukážeme všechny — pro orientaci.
  const sourceCounts = new Map<string, number>();
  for (const e of events) {
    sourceCounts.set(e.source, (sourceCounts.get(e.source) ?? 0) + 1);
  }
  const totalCount = events.length || 1;
  const dominantSource = Array.from(sourceCounts.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  const dominantShare = dominantSource
    ? (sourceCounts.get(dominantSource) ?? 0) / totalCount
    : 0;
  // Zobrazit zdroj jen pokud je distribuce smíšená (dominant pod 80 %) NEBO
  // event není z dominantního zdroje.
  const showSourceBadge = (src: string): boolean => {
    if (dominantShare >= 0.8) return src !== dominantSource;
    return true;
  };

  // ----- Window timeline -----
  // Petr: nezobrazovat ranní hodiny ve kterých se spí. Začni od first event - 1h.
  const earliestStartMs = timedEvents.length > 0
    ? Math.min(...timedEvents.map((e) => new Date(e.startsAt).getTime()))
    : new Date(`${date}T08:00:00`).getTime();
  const latestEndMs = timedEvents.length > 0
    ? Math.max(...timedEvents.map((e) => new Date(e.endsAt).getTime()))
    : new Date(`${date}T20:00:00`).getTime();

  let windowStart = new Date(earliestStartMs - 60 * 60 * 1000);
  let windowEnd = new Date(latestEndMs + 60 * 60 * 1000);
  if (windowEnd > dayEnd) windowEnd = dayEnd;
  // Pokud je dnešek a now mimo okno, posuň
  if (isToday) {
    if (now > windowEnd) windowEnd = new Date(now.getTime() + 60 * 60 * 1000);
    if (now < windowStart) windowStart = new Date(now.getTime() - 30 * 60 * 1000);
  }

  // Zaokrouhli grid na celé hodiny
  const gridStart = new Date(windowStart);
  gridStart.setMinutes(0, 0, 0);
  const gridEnd = new Date(windowEnd);
  if (gridEnd.getMinutes() > 0 || gridEnd.getSeconds() > 0) {
    gridEnd.setHours(gridEnd.getHours() + 1, 0, 0, 0);
  }

  const totalMin = Math.max(60, (gridEnd.getTime() - gridStart.getTime()) / 60_000);
  const totalPx = totalMin * MIN_PX;

  // Hodinové popisky
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

  // ----- Detekce background eventů (long >3h s overlap krátkého) -----
  const longIds = new Set<string>(
    timedEvents
      .filter((e) => {
        const dur = (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 60_000;
        return dur > LONG_THRESHOLD_MIN;
      })
      .map((e) => e.id),
  );
  const backgroundIds = new Set<string>();
  for (const longEv of timedEvents.filter((e) => longIds.has(e.id))) {
    const ls = new Date(longEv.startsAt).getTime();
    const le = new Date(longEv.endsAt).getTime();
    const hasShortOverlap = timedEvents.some(
      (other) =>
        other.id !== longEv.id &&
        !longIds.has(other.id) &&
        new Date(other.startsAt).getTime() < le &&
        new Date(other.endsAt).getTime() > ls,
    );
    if (hasShortOverlap) backgroundIds.add(longEv.id);
  }

  // Foreground = events co půjdou do sloupců (vše kromě background)
  const foregroundEvents = timedEvents.filter((e) => !backgroundIds.has(e.id));
  const bgEvents = timedEvents.filter((e) => backgroundIds.has(e.id));

  // Přiřaď sloupce jen FG eventům
  const colMap = useMemo(() => assignColumns(foregroundEvents), [foregroundEvents]);

  // Now pozice
  const nowMin = (now.getTime() - gridStart.getTime()) / 60_000;
  const nowPx = nowMin * MIN_PX;
  const showNow = isToday && nowMin >= 0 && nowMin <= totalMin;

  return (
    <section className="glass rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-serif text-lg">Plán</h2>
        <span className="ml-auto text-xs font-mono text-muted-foreground">
          {events.length} {events.length === 1 ? "událost" : "události"}
        </span>
      </div>
      {/* Legenda zdrojů — kompaktní pruh nad osou. Petr potřebuje rychle
          mapovat barvu na zdroj. */}
      {events.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground mb-3 pb-2 border-b border-white/[0.05]">
          <LegendDot tint="sky" label="Petr" />
          <LegendDot tint="rose" label="partnerka" />
          <LegendDot tint="mint" label="syn" />
          <LegendDot tint="butter" label="ostatní" />
        </div>
      )}

      {/* All-day proužky nad osou */}
      {allDayEvents.length > 0 && (
        <div className="space-y-1 mb-3">
          {allDayEvents.map((e) => {
            const tint = sourceTint(e.source);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setOpenId(openId === e.id ? null : e.id)}
                className="w-full text-left rounded-md px-2.5 py-1.5 text-xs flex items-center gap-2 transition-colors"
                style={{
                  background: `color-mix(in oklch, var(--tint-${tint}) 14%, transparent)`,
                  border: `1px solid color-mix(in oklch, var(--tint-${tint}) 30%, transparent)`,
                }}
              >
                <span className="text-[9px] font-mono uppercase tracking-wider opacity-60">celý den</span>
                <span className="flex-1 truncate text-foreground">{e.title}</span>
                <span className="text-[9px] font-mono opacity-60">{sourceLabel(e.source)}</span>
              </button>
            );
          })}
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
          {/* Hodinové čáry — TLUMENÉ (opacity ~17%, nezakrývají bloky) */}
          {hourLabels.map((h, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 flex items-start pointer-events-none"
              style={{ top: `${h.topPx}px` }}
            >
              <span
                className="text-[10px] font-mono w-12 -translate-y-1.5 tabular shrink-0"
                style={{ color: "color-mix(in oklch, var(--foreground) 50%, transparent)" }}
              >
                {h.label}
              </span>
              <div
                className="flex-1 border-t"
                style={{ borderColor: "color-mix(in oklch, var(--foreground) 8%, transparent)" }}
              />
            </div>
          ))}

          {/* BACKGROUND events (long > 3h, levá polovina, opacita 40%) */}
          {bgEvents.map((e) => {
            const tint = sourceTint(e.source);
            const start = new Date(e.startsAt);
            const end = new Date(e.endsAt);
            const startMin = Math.max(0, (start.getTime() - gridStart.getTime()) / 60_000);
            const endMin = Math.min(totalMin, (end.getTime() - gridStart.getTime()) / 60_000);
            const durHours = (end.getTime() - start.getTime()) / 3_600_000;
            const isOpen = openId === e.id;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setOpenId(isOpen ? null : e.id)}
                className="absolute rounded-lg overflow-hidden text-left transition-all hover:brightness-110 active:scale-[0.99]"
                style={{
                  // Přesný top podle startMin — žádný offset, pixel-perfect
                  top: `${startMin * MIN_PX}px`,
                  // Gap se odečítá jen z DNA bloku, ne z TOPu — top musí
                  // přesně sedět s časem začátku
                  height: `${Math.max(20, (endMin - startMin) * MIN_PX - BLOCK_GAP_PX)}px`,
                  left: `${LEFT_GUTTER_PX}px`,
                  width: `calc(50% - ${LEFT_GUTTER_PX / 2}px)`,
                  background: `color-mix(in oklch, var(--tint-${tint}) 18%, transparent)`,
                  border: `1px dashed color-mix(in oklch, var(--tint-${tint}) 35%, transparent)`,
                  opacity: 0.55,
                  boxShadow: isOpen
                    ? `0 0 0 2px color-mix(in oklch, var(--tint-${tint}) 50%, transparent)`
                    : undefined,
                }}
              >
                {/* Top group (čas + název) v levém horním rohu, length+source
                    v levém dolním rohu. flex justify-between roztáhne mezery —
                    název zůstává čitelný i když přes střed jde fg blok.
                    Pokud je BG event krátký (≤2h výšky bloku), length se
                    vynechá aby nezahltil malý prostor. */}
                <div className="h-full flex flex-col justify-between px-2.5 py-1.5">
                  <div className="space-y-0.5">
                    <div className="text-[10px] font-mono tabular font-semibold opacity-90">
                      {fmtTime(start)}–{fmtTime(end)}
                    </div>
                    <div
                      className="text-xs font-medium leading-tight line-clamp-2"
                      style={{ color: `color-mix(in oklch, var(--tint-${tint}) 96%, white)` }}
                    >
                      {e.title}
                    </div>
                  </div>
                  {durHours > 2 && (
                    <div className="text-[9px] font-mono uppercase opacity-60 leading-none">
                      {Math.round(durHours)} h
                      {showSourceBadge(e.source) && ` · ${sourceLabel(e.source)}`}
                    </div>
                  )}
                </div>
              </button>
            );
          })}

          {/* FOREGROUND events — sloupce */}
          {foregroundEvents.map((e) => {
            const tint = sourceTint(e.source);
            const start = new Date(e.startsAt);
            const end = new Date(e.endsAt);
            const startMin = Math.max(0, (start.getTime() - gridStart.getTime()) / 60_000);
            const endMin = Math.min(totalMin, (end.getTime() - gridStart.getTime()) / 60_000);
            const durationMin = (end.getTime() - start.getTime()) / 60_000;
            // Přesná výška: gap odečteme jen ze spodku bloku, top sedí pixel-perfect
            const heightPx = Math.max(18, (endMin - startMin) * MIN_PX - BLOCK_GAP_PX);
            const isOpen = openId === e.id;
            const assignment = colMap.get(e);
            const totalColumns = assignment?.totalColumns ?? 1;
            const column = assignment?.column ?? 0;

            const overlapsBg = bgEvents.some(
              (bg) =>
                new Date(bg.startsAt).getTime() < end.getTime() &&
                new Date(bg.endsAt).getTime() > start.getTime(),
            );
            const fgLeftPercent = overlapsBg ? 50 : 0;
            const fgRightPercent = 100;
            const fgWidth = (fgRightPercent - fgLeftPercent) / totalColumns;
            const blockLeftPercent = fgLeftPercent + column * fgWidth;

            // Adaptivní velikost obsahu podle výšky bloku
            const isShort = heightPx < 36; // < ~30 min
            const isMedium = heightPx >= 36 && heightPx < 60;
            const showLocation = heightPx >= 60 && e.locationText;
            const isLong = durationMin > LONG_THRESHOLD_MIN;
            const showLengthBadge = isLong && heightPx >= 80;
            const showSource = showSourceBadge(e.source);

            // Minulé eventy (skončily před teď) ztlumit aby Petr viděl
            // co už proběhlo. Aktivní/budoucí v plné barvě. Jen pro dnes.
            const isPast = isToday && end.getTime() < now.getTime();

            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setOpenId(isOpen ? null : e.id)}
                className="absolute rounded-lg overflow-hidden text-left transition-all hover:brightness-110 active:scale-[0.99]"
                style={{
                  // Přesný top podle startMin — pixel-perfect
                  top: `${startMin * MIN_PX}px`,
                  height: `${heightPx}px`,
                  left:
                    overlapsBg
                      ? `calc(${blockLeftPercent}% + 1px)`
                      : `calc(${LEFT_GUTTER_PX}px + ${(blockLeftPercent / 100) * (100 - LEFT_GUTTER_PX / 4)}%)`,
                  width: overlapsBg
                    ? `calc(${fgWidth}% - 2px)`
                    : `calc(${fgWidth}% - ${LEFT_GUTTER_PX / totalColumns}px - 1px)`,
                  background: `color-mix(in oklch, var(--tint-${tint}) ${isRitual(e.source) ? 18 : 28}%, transparent)`,
                  border: isRitual(e.source)
                    ? `1px dashed color-mix(in oklch, var(--tint-${tint}) 60%, transparent)`
                    : `1px solid color-mix(in oklch, var(--tint-${tint}) 50%, transparent)`,
                  opacity: isPast ? 0.45 : 1,
                  touchAction: "manipulation",
                  zIndex: isRitual(e.source) ? 2 : 3, // ujistit klikatelnost
                  boxShadow: isOpen
                    ? `0 0 0 2px color-mix(in oklch, var(--tint-${tint}) 65%, transparent)`
                    : undefined,
                }}
              >
                {/* Vždy top-aligned, padding nahoru jemný. Text vlevo + source vpravo. */}
                <div
                  className={`h-full flex flex-col items-stretch overflow-hidden ${
                    isShort ? "px-1.5 pt-0.5 pb-0 gap-0" : "px-2 pt-1 pb-1 gap-0.5"
                  }`}
                >
                  {/* ČAS — vždy nahoře */}
                  <div
                    className={`font-mono tabular font-semibold leading-none opacity-90 ${
                      isShort ? "text-[9px]" : "text-[10px]"
                    }`}
                  >
                    {fmtTime(start)}–{fmtTime(end)}
                  </div>
                  {/* NÁZEV — vždy hned pod, top-aligned. Truncate v krátkých,
                      line-clamp-2 ve středních+. */}
                  <div
                    className={`font-medium leading-tight ${
                      isShort
                        ? "text-[10.5px] truncate"
                        : isMedium
                          ? "text-xs line-clamp-1"
                          : "text-xs line-clamp-2"
                    }`}
                    style={{ color: `color-mix(in oklch, var(--tint-${tint}) 96%, white)` }}
                  >
                    {e.title}
                  </div>
                  {showLocation && (
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1 truncate leading-tight mt-auto">
                      <MapPin className="size-2.5 shrink-0" />
                      <span className="truncate">{e.locationText}</span>
                    </div>
                  )}
                </div>

                {/* Source badge — jen pokud je smíšená distribuce nebo
                    minoritní zdroj. Navíc skryto v krátkých blocích, kam by
                    nešel, ať nezakrývá text. */}
                {showSource && !isShort && (
                  <span className="absolute top-1 right-1.5 text-[9px] font-mono opacity-50">
                    {sourceLabel(e.source)}
                  </span>
                )}

                {/* Length badge — u všech long event (>3h) v levém dolním rohu */}
                {showLengthBadge && (
                  <span className="absolute bottom-1 left-2 text-[9px] font-mono uppercase opacity-50">
                    {Math.round(durationMin / 60)} h
                    {showSource && ` · ${sourceLabel(e.source)}`}
                  </span>
                )}
              </button>
            );
          })}

          {/* Now čára — terakota, přes všechno (z-50). Čára jde přes celou
              šířku osy (od LEFT_GUTTER doprava). Časový badge se vznáší NA
              čáře v pravé části (mimo gutter, aby nepřekrýval popisek hodiny). */}
          {showNow && (
            <div
              ref={nowMarkerRef}
              className="absolute left-0 right-0 pointer-events-none"
              style={{ top: `${nowPx}px`, zIndex: 50 }}
            >
              {/* Čára přes celou šířku osy — přesně na nowPx */}
              <div
                className="absolute"
                style={{
                  left: `${LEFT_GUTTER_PX}px`,
                  right: 0,
                  top: 0,
                  borderTop: "2px solid oklch(72% 0.14 35)",
                }}
              />
              {/* Levý bod na začátku čáry */}
              <div
                className="absolute size-2 rounded-full"
                style={{
                  left: `${LEFT_GUTTER_PX - 4}px`,
                  top: "-3px",
                  background: "oklch(72% 0.14 35)",
                }}
              />
              {/* Časový badge — pill nad čárou na pravé straně, mimo gutter
                  i nad bloky (ne uprostřed kde by maskoval text) */}
              <span
                className="absolute text-[10px] font-mono font-bold tabular px-1.5 py-0.5 rounded"
                style={{
                  right: "0.25rem",
                  top: "-9px",
                  background: "oklch(72% 0.14 35)",
                  color: "oklch(15% 0.02 35)",
                }}
              >
                {fmtTime(now)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Floating tlačítko "skok na teď" — viditelné jen když je now mimo
          viewport. Pozice: fixed na okraji obrazovky, šipka nahoru/dolů
          podle směru. */}
      {showNow && nowVisibility !== "in" && (
        <button
          type="button"
          onClick={scrollToNow}
          className="fixed right-3 z-40 inline-flex items-center gap-1.5 px-3 py-2 rounded-full shadow-lg text-xs font-mono font-semibold transition-all active:scale-95"
          style={{
            top: nowVisibility === "above" ? "5rem" : undefined,
            bottom: nowVisibility === "below" ? "5rem" : undefined,
            background: "oklch(72% 0.14 35 / 0.95)",
            color: "oklch(15% 0.02 35)",
            border: "1px solid oklch(72% 0.14 35)",
          }}
          aria-label="Skok na aktuální čas"
        >
          {nowVisibility === "above" ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          )}
          teď · {fmtTime(now)}
        </button>
      )}

      {/* Anchor pro scroll-into-view fallback (pokud nowMarker chybí mimo today) */}
      <div ref={scrollAnchorRef} />
      {/* (scrollAnchorRef je rezerva — pokud bys chtěl scrollnout někam jinam) */}

      {/* Detail — portal-rendered fixed modal. Portal do <body> zaručuje že
          ho neovlivní žádný ancestor s transformem/filtrem (CSS containing block). */}
      {openId && mounted && (() => {
        const ev = events.find((e) => e.id === openId);
        if (!ev) return null;
        const tint = sourceTint(ev.source);
        const start = new Date(ev.startsAt);
        const end = new Date(ev.endsAt);
        return createPortal((
          <div
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3 sm:p-6"
            onClick={() => setOpenId(null)}
            style={{ background: "oklch(8% 0.02 260 / 0.55)", backdropFilter: "blur(8px)" }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-2xl p-5 space-y-2 text-sm shadow-2xl"
              style={{
                background: "oklch(14% 0.025 260 / 0.98)",
                border: `1px solid color-mix(in oklch, var(--tint-${tint}) 35%, transparent)`,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-mono tabular font-semibold mb-0.5" style={{ color: `color-mix(in oklch, var(--tint-${tint}) 90%, white)` }}>
                    {ev.allDay ? "celý den" : `${fmtTime(start)}–${fmtTime(end)}`}
                  </div>
                  <h3
                    className="font-serif text-lg leading-tight"
                    style={{ color: `color-mix(in oklch, var(--tint-${tint}) 96%, white)` }}
                  >
                    {ev.title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenId(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Zavřít detail"
                >
                  <X className="size-4" />
                </button>
              </div>
              {isRitual(ev.source) ? (
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
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--tint-peach)] flex items-center gap-1 pt-2 mt-2 border-t border-white/[0.05]">
                    <Sparkles className="size-3" /> rituál
                    <a
                      href="/settings/ritualy"
                      className="ml-auto hover:underline"
                    >
                      upravit text →
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs font-mono text-muted-foreground tabular flex flex-wrap gap-x-3 gap-y-1">
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
                </>
              )}
            </div>
          </div>
        ), document.body);
      })()}

    </section>
  );
}

function LegendDot({ tint, label }: { tint: string; label: string }) {
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
