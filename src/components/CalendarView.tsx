import { useEffect, useMemo, useState } from "react";
import { Calendar, dayjsLocalizer, Views, type View } from "react-big-calendar";
import dayjs from "dayjs";
import "dayjs/locale/cs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import isoWeek from "dayjs/plugin/isoWeek";
import { Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import "react-big-calendar/lib/css/react-big-calendar.css";

dayjs.extend(customParseFormat);
dayjs.extend(isoWeek);
dayjs.locale("cs");

const localizer = dayjsLocalizer(dayjs);

interface CalendarEventDTO {
  id: string;
  source: string;
  type: string;
  title: string;
  description: string | null;
  locationText: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  sourceUrl: string | null;
  location: { name: string; isLocal: boolean } | null;
}

interface BigCalEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: CalendarEventDTO;
}

const TYPE_TO_TINT: Record<string, string> = {
  MEETING_PRAGUE: "var(--tint-peach)",
  MEETING_HOME: "var(--tint-mint)",
  MEETING_ELSEWHERE: "var(--tint-sky)",
  MEETING_ONLINE: "var(--tint-lavender)",
  PERSONAL: "var(--tint-rose)",
  HOCKEY_SON: "var(--tint-butter)",
  PARTNER_SHIFT: "var(--tint-sage)",
  PARTNER_VACATION: "var(--tint-sage)",
  OOO_FULL: "var(--tint-pink)",
  OOO_TRAVEL_WORKING: "var(--tint-pink)",
  OTHER: "var(--muted-foreground)",
};

export default function CalendarView({ googleConnected }: { googleConnected: boolean }) {
  const [view, setView] = useState<View>(Views.WEEK);
  const [date, setDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<BigCalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CalendarEventDTO | null>(null);

  const range = useMemo(() => {
    const start = view === Views.MONTH
      ? dayjs(date).startOf("month").subtract(7, "day").toDate()
      : view === Views.WEEK
        ? dayjs(date).startOf("isoWeek").subtract(1, "day").toDate()
        : dayjs(date).startOf("day").toDate();
    const end = view === Views.MONTH
      ? dayjs(date).endOf("month").add(7, "day").toDate()
      : view === Views.WEEK
        ? dayjs(date).endOf("isoWeek").add(1, "day").toDate()
        : dayjs(date).endOf("day").toDate();
    return { start, end };
  }, [date, view]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        from: range.start.toISOString(),
        to: range.end.toISOString(),
      });
      const res = await fetch("/api/calendar/events?" + params.toString());
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Nelze načíst události");
        return;
      }
      setEvents(
        (data.events as CalendarEventDTO[]).map((e) => ({
          id: e.id,
          title: e.title,
          start: new Date(e.startsAt),
          end: new Date(e.endsAt),
          allDay: e.allDay,
          resource: e,
        })),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [range.start.getTime(), range.end.getTime()]);

  if (!googleConnected) {
    return (
      <div className="glass rounded-xl p-8 text-center" style={{ ["--c" as string]: "var(--tint-butter)" }}>
        <AlertTriangle className="size-10 mx-auto mb-3 text-[var(--tint-butter)]" />
        <h2 className="font-serif text-xl mb-2">Nejdřív připoj Google</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Pro zobrazení kalendáře musíš připojit svůj Google Workspace účet.
        </p>
        <a
          href="/settings/integrations/google"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-foreground/90 text-background text-sm font-medium"
        >
          Otevřít nastavení Google
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <style dangerouslySetInnerHTML={{ __html: CALENDAR_OVERRIDES }} />

      <div className="glass rounded-xl p-2">
        <div className="rbc-calendar-wrapper" style={{ height: "calc(100vh - 220px)", minHeight: 500 }}>
          <Calendar
            localizer={localizer}
            events={events}
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            views={[Views.WEEK, Views.MONTH, Views.DAY]}
            defaultView={Views.WEEK}
            messages={MESSAGES_CS}
            culture="cs"
            startAccessor="start"
            endAccessor="end"
            allDayAccessor="allDay"
            onSelectEvent={(e) => setSelected(e.resource)}
            eventPropGetter={(e) => {
              const tint = TYPE_TO_TINT[e.resource.type] ?? "var(--muted-foreground)";
              const isExternal = e.resource.source !== "GOOGLE_PRIMARY";
              return {
                style: {
                  background: `color-mix(in oklch, ${tint} 22%, transparent)`,
                  border: `1px solid color-mix(in oklch, ${tint} 50%, transparent)`,
                  color: "var(--foreground)",
                  fontSize: "12px",
                  borderRadius: "4px",
                  opacity: isExternal ? 0.7 : 1,
                },
              };
            }}
            min={dayjs().hour(7).minute(0).toDate()}
            max={dayjs().hour(22).minute(0).toDate()}
          />
        </div>
      </div>

      {loading && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" /> načítám události…
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {selected && <EventDetailModal event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function EventDetailModal({ event, onClose }: { event: CalendarEventDTO; onClose: () => void }) {
  const tint = TYPE_TO_TINT[event.type] ?? "var(--muted-foreground)";
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel max-w-md w-full p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
        style={{ ["--c" as string]: tint }}
      >
        <div className="flex items-start gap-2">
          <div className="size-3 rounded-full mt-1.5" style={{ background: tint }} />
          <div className="flex-1 min-w-0">
            <h3 className="font-serif text-lg leading-tight">{event.title}</h3>
            <div className="text-xs font-mono text-muted-foreground mt-1">
              {event.allDay ? "Celý den" : `${start.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })} – ${end.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`}
              {" · "}{start.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
          <span className="px-2 py-0.5 rounded" style={{ background: `color-mix(in oklch, var(--c) 18%, transparent)`, color: "var(--c)" }}>
            {event.type}
          </span>
          <span className="px-2 py-0.5 rounded bg-white/5 text-muted-foreground">{event.source}</span>
        </div>

        {event.locationText && (
          <div className="text-sm">
            <span className="text-muted-foreground text-xs">📍 </span>
            {event.location?.name ?? event.locationText}
          </div>
        )}

        {event.description && (
          <div className="text-sm whitespace-pre-wrap text-foreground/80 max-h-60 overflow-y-auto">
            {event.description}
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t border-white/5">
          {event.sourceUrl && (
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md hover:bg-white/5 text-sm text-muted-foreground"
            >
              <ExternalLink className="size-3" /> Otevřít v Google
            </a>
          )}
          <button onClick={onClose} className="ml-auto px-3 py-1.5 rounded-md hover:bg-white/5 text-sm">
            Zavřít
          </button>
        </div>
      </div>
    </div>
  );
}

const MESSAGES_CS = {
  date: "Datum",
  time: "Čas",
  event: "Událost",
  allDay: "Celý den",
  week: "Týden",
  work_week: "Pracovní týden",
  day: "Den",
  month: "Měsíc",
  previous: "Předchozí",
  next: "Další",
  yesterday: "Včera",
  tomorrow: "Zítra",
  today: "Dnes",
  agenda: "Přehled",
  noEventsInRange: "Žádné události v tomto rozsahu.",
  showMore: (n: number) => `+${n} dalších`,
};

// Tailwind-friendly CSS overrides — react-big-calendar má vlastní výchozí styly,
// musíme je sladit s naším Liquid Glass dark theme.
const CALENDAR_OVERRIDES = `
.rbc-calendar-wrapper .rbc-calendar { background: transparent; color: var(--foreground); font-family: inherit; }
.rbc-calendar-wrapper .rbc-toolbar { padding: 8px; gap: 8px; flex-wrap: wrap; }
.rbc-calendar-wrapper .rbc-toolbar button {
  background: rgba(255,255,255,0.04); color: var(--foreground); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px; padding: 5px 12px; font-size: 13px; transition: background 0.12s;
}
.rbc-calendar-wrapper .rbc-toolbar button:hover { background: rgba(255,255,255,0.08); }
.rbc-calendar-wrapper .rbc-toolbar button.rbc-active { background: var(--tint-peach); color: #1a1a1a; border-color: var(--tint-peach); }
.rbc-calendar-wrapper .rbc-toolbar-label { font-family: 'Fraunces Variable', serif; font-size: 18px; font-weight: 600; flex: 1; text-align: center; }

.rbc-calendar-wrapper .rbc-header { padding: 8px 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); border-bottom: 1px solid rgba(255,255,255,0.08); background: transparent; }
.rbc-calendar-wrapper .rbc-month-view, .rbc-calendar-wrapper .rbc-time-view, .rbc-calendar-wrapper .rbc-agenda-view { border: none; }
.rbc-calendar-wrapper .rbc-day-bg, .rbc-calendar-wrapper .rbc-day-slot, .rbc-calendar-wrapper .rbc-time-slot, .rbc-calendar-wrapper .rbc-month-row, .rbc-calendar-wrapper .rbc-time-content, .rbc-calendar-wrapper .rbc-time-header-content, .rbc-calendar-wrapper .rbc-time-gutter, .rbc-calendar-wrapper .rbc-time-header-gutter { border-color: rgba(255,255,255,0.06) !important; }
.rbc-calendar-wrapper .rbc-today { background: rgba(245, 200, 150, 0.06) !important; }
.rbc-calendar-wrapper .rbc-event { padding: 2px 6px !important; }
.rbc-calendar-wrapper .rbc-time-slot { border-top: 1px dotted rgba(255,255,255,0.04) !important; }
.rbc-calendar-wrapper .rbc-current-time-indicator { background: var(--tint-peach); height: 2px; }
.rbc-calendar-wrapper .rbc-off-range-bg { background: rgba(0,0,0,0.15) !important; }
.rbc-calendar-wrapper .rbc-off-range { color: var(--muted-foreground); opacity: 0.5; }
.rbc-calendar-wrapper .rbc-show-more { color: var(--tint-peach); font-size: 11px; }
.rbc-calendar-wrapper .rbc-time-gutter .rbc-label { font-size: 10px; color: var(--muted-foreground); }
.rbc-calendar-wrapper .rbc-date-cell { padding: 4px 6px; font-size: 12px; }
.rbc-calendar-wrapper .rbc-date-cell.rbc-now { font-weight: 700; color: var(--tint-peach); }
`;
