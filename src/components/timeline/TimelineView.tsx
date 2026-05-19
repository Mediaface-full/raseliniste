/**
 * Timeline View — root React island.
 *
 * F1 MVP (Petr 2026-05-19):
 * - Hero s project dropdown + stats + theme toggle + zoom
 * - Filters: sub-projekty + tým multi-select chipy
 * - Canvas: SVG s lanes per osoba, task bloky, today line, drag horizontal
 * - Detail card pod canvasem (po kliku na task)
 * - Theme local (data-theme=light|dark), localStorage persist
 * - Responsive (mobile breakpoint 640px)
 *
 * F2 přidá: milestone stamps, keyboard nav, accessibility
 * F3: PDF export
 * F4: Share link (public read-only)
 * F5: Drag úkolu na jiný den
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Moon, Sun, Calendar, ExternalLink, X } from "lucide-react";
import type {
  Theme,
  Zoom,
  TimelineProject,
  TimelineProjectOption,
  TimelineTask,
  TimelineTeamMember,
  TimelineSubproject,
} from "./types";
import {
  detectInitialTheme,
  persistTheme,
} from "@/lib/timeline/theme-detection";
import {
  paletteColor,
  hexA,
  taskTitleColor,
} from "@/lib/timeline/color-utils";
import {
  todayIso,
  daysBetween,
  addDays,
  dateRange,
  isWeekend,
  fromIsoDate,
  formatDateShort,
  formatDateLong,
} from "@/lib/timeline/date-utils";

// =============================================================================
// Dimensions per zoom (design_tokens.md § 7.1)
// =============================================================================
const DAY_WIDTH: Record<Zoom, number> = { week: 60, month: 30, quarter: 15 };
const LANE_HEIGHT = 62;
const HEADER_HEIGHT = 58;
const AVATAR_COL_WIDTH = 110;
const AVATAR_COL_WIDTH_MOBILE = 80;
const TASK_VERTICAL_PADDING = 13;
const TASK_HEIGHT = LANE_HEIGHT - 26; // 36px

// =============================================================================
// Hlavní komponenta
// =============================================================================
interface Props {
  initialProjectId?: string;
}

export default function TimelineView({ initialProjectId }: Props) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [options, setOptions] = useState<TimelineProjectOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialProjectId ?? null);
  const [project, setProject] = useState<TimelineProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>("month");
  const [activeSubs, setActiveSubs] = useState<Set<string>>(new Set());
  const [activeTeam, setActiveTeam] = useState<Set<string>>(new Set());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Init theme
  useEffect(() => {
    setTheme(detectInitialTheme());
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    persistTheme(next);
  }

  // Load project options
  useEffect(() => {
    fetch("/api/timeline/list")
      .then((r) => r.json())
      .then((data) => {
        const opts: TimelineProjectOption[] = data.options ?? [];
        setOptions(opts);
        if (!selectedId && opts.length > 0) {
          // Prefer Team projekt, fallback první
          const firstTeam = opts.find((o) => o.isTeamProject);
          setSelectedId(firstTeam?.id ?? opts[0]!.id);
        }
      })
      .catch((e) => setError(`Načtení projektů selhalo: ${e?.message ?? e}`));
  }, []);

  // Load selected project
  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/timeline/${encodeURIComponent(selectedId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const p: TimelineProject = data.project;
        setProject(p);
        setActiveSubs(new Set(p.subprojects.map((s) => s.id)));
        setActiveTeam(new Set(p.team.map((t) => t.id)));
        setSelectedTaskId(null);
      })
      .catch((e) => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  }, [selectedId]);

  // Stats — viditelných úkolů + done % + délka projektu + týmem
  const stats = useMemo(() => {
    if (!project) return null;
    const visibleTasks = project.tasks.filter(
      (t) => activeSubs.has(t.subprojectId) && activeTeam.has(t.assigneeId),
    );
    const done = visibleTasks.filter((t) => t.completed).length;
    const donePct = visibleTasks.length > 0 ? Math.round((done / visibleTasks.length) * 100) : 0;
    const days = daysBetween(project.startDate, project.endDate);
    return {
      visibleTasksCount: visibleTasks.length,
      doneCount: done,
      donePct,
      days,
      teamCount: project.team.filter((t) => activeTeam.has(t.id)).length,
    };
  }, [project, activeSubs, activeTeam]);

  function toggleSub(id: string) {
    setActiveSubs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleTeam(id: string) {
    setActiveTeam((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const selectedTask = useMemo(() => {
    if (!project || !selectedTaskId) return null;
    return project.tasks.find((t) => t.id === selectedTaskId) ?? null;
  }, [project, selectedTaskId]);

  return (
    <div className="timeline-view" data-theme={theme}>
      <h2 className="sr-only">Project Timeline View</h2>

      {error && (
        <div className="tv-card" style={{ padding: 12, marginBottom: 12, color: "var(--tv-today)" }}>
          ⚠ {error}
        </div>
      )}

      <Hero
        options={options}
        selectedId={selectedId}
        onSelect={setSelectedId}
        project={project}
        loading={loading}
        stats={stats}
        theme={theme}
        onToggleTheme={toggleTheme}
        zoom={zoom}
        onZoomChange={setZoom}
      />

      {project && (
        <>
          <Filters
            project={project}
            activeSubs={activeSubs}
            activeTeam={activeTeam}
            onToggleSub={toggleSub}
            onToggleTeam={toggleTeam}
            theme={theme}
          />

          {project.tasks.length === 0 && project.milestones.length === 0 ? (
            <EmptyState projectId={project.id} />
          ) : (
            <Canvas
              project={project}
              activeSubs={activeSubs}
              activeTeam={activeTeam}
              zoom={zoom}
              theme={theme}
              selectedTaskId={selectedTaskId}
              onSelectTask={setSelectedTaskId}
            />
          )}

          {selectedTask && (
            <Detail
              task={selectedTask}
              project={project}
              theme={theme}
              onClose={() => setSelectedTaskId(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
// Hero — project select + stats + theme toggle + zoom
// =============================================================================
function Hero(props: {
  options: TimelineProjectOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  project: TimelineProject | null;
  loading: boolean;
  stats: { visibleTasksCount: number; doneCount: number; donePct: number; days: number; teamCount: number } | null;
  theme: Theme;
  onToggleTheme: () => void;
  zoom: Zoom;
  onZoomChange: (z: Zoom) => void;
}) {
  return (
    <div className="tv-card" style={{ padding: "18px 20px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <Calendar size={20} style={{ color: "var(--tv-text-secondary)" }} />
        <select
          className="tv-select"
          value={props.selectedId ?? ""}
          onChange={(e) => props.onSelect(e.target.value)}
          disabled={props.loading}
        >
          {props.options.length === 0 && <option value="">Žádné projekty</option>}
          {props.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}{o.isParent ? ` (${o.subprojectCount} sub)` : ""}{o.isTeamProject ? " ✦" : ""}
            </option>
          ))}
        </select>
        {props.project && <h1 className="tv-h1" style={{ margin: 0 }}>{props.project.name}</h1>}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <SegmentedControl value={props.zoom} onChange={props.onZoomChange} />
          <button
            className="tv-icon-btn"
            onClick={props.onToggleTheme}
            aria-label={props.theme === "dark" ? "Přepnout na světlý motiv" : "Přepnout na tmavý motiv"}
            title={props.theme === "dark" ? "Světlý motiv" : "Tmavý motiv"}
          >
            {props.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>

      {props.stats && (
        <div className="tv-stat-grid">
          <StatTile label="Úkoly" value={props.stats.visibleTasksCount.toString()} meta={`${props.stats.doneCount} hotovo`} />
          <StatTile label="Hotovo" value={`${props.stats.donePct}%`} meta="z viditelných" />
          <StatTile label="Délka" value={`${props.stats.days} dní`} meta="rozsah projektu" />
          <StatTile label="Tým" value={props.stats.teamCount.toString()} meta="aktivních" />
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="tv-card-inner" style={{ padding: "10px 12px" }}>
      <div className="tv-stat-label">{label}</div>
      <div className="tv-h2" style={{ margin: "2px 0" }}>{value}</div>
      {meta && <div className="tv-caption">{meta}</div>}
    </div>
  );
}

function SegmentedControl({ value, onChange }: { value: Zoom; onChange: (z: Zoom) => void }) {
  const opts: { v: Zoom; label: string }[] = [
    { v: "week", label: "Týden" },
    { v: "month", label: "Měsíc" },
    { v: "quarter", label: "Kvartál" },
  ];
  return (
    <div className="tv-segmented">
      {opts.map((o) => (
        <button
          key={o.v}
          className={`tv-segmented__btn ${value === o.v ? "tv-segmented__btn--active" : ""}`}
          onClick={() => onChange(o.v)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// Filters — sub-projekty + tým
// =============================================================================
function Filters(props: {
  project: TimelineProject;
  activeSubs: Set<string>;
  activeTeam: Set<string>;
  onToggleSub: (id: string) => void;
  onToggleTeam: (id: string) => void;
  theme: Theme;
}) {
  return (
    <div className="tv-card" style={{ padding: "11px 13px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span className="tv-eyebrow">Sub-projekty</span>
        {props.project.subprojects.map((s) => (
          <ChipSub
            key={s.id}
            sub={s}
            active={props.activeSubs.has(s.id)}
            onClick={() => props.onToggleSub(s.id)}
            theme={props.theme}
          />
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="tv-eyebrow">Tým</span>
        {props.project.team.map((m) => (
          <ChipMember
            key={m.id}
            member={m}
            active={props.activeTeam.has(m.id)}
            onClick={() => props.onToggleTeam(m.id)}
            theme={props.theme}
          />
        ))}
      </div>
    </div>
  );
}

function ChipSub({ sub, active, onClick, theme }: {
  sub: TimelineSubproject; active: boolean; onClick: () => void; theme: Theme;
}) {
  const color = paletteColor(sub.colorIndex, theme);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tv-chip ${active ? "" : "tv-chip--inactive"}`}
      aria-pressed={active}
    >
      <span className="tv-chip__dot" style={{ background: color }} />
      {sub.name}
    </button>
  );
}

function ChipMember({ member, active, onClick, theme }: {
  member: TimelineTeamMember; active: boolean; onClick: () => void; theme: Theme;
}) {
  const color = paletteColor(member.colorIndex, theme);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tv-chip ${active ? "" : "tv-chip--inactive"}`}
      aria-pressed={active}
    >
      <span className="tv-chip__dot" style={{ background: color }} />
      {member.name}
    </button>
  );
}

// =============================================================================
// Canvas — SVG s lanes + tasks + today line
// =============================================================================
function Canvas(props: {
  project: TimelineProject;
  activeSubs: Set<string>;
  activeTeam: Set<string>;
  zoom: Zoom;
  theme: Theme;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const dayWidth = DAY_WIDTH[props.zoom];
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
  const avatarCol = isMobile ? AVATAR_COL_WIDTH_MOBILE : AVATAR_COL_WIDTH;

  const days = useMemo(
    () => dateRange(props.project.startDate, props.project.endDate),
    [props.project.startDate, props.project.endDate],
  );

  const visibleTeam = useMemo(
    () => props.project.team.filter((m) => props.activeTeam.has(m.id)),
    [props.project.team, props.activeTeam],
  );

  const visibleTasks = useMemo(
    () => props.project.tasks.filter(
      (t) => props.activeSubs.has(t.subprojectId) && props.activeTeam.has(t.assigneeId),
    ),
    [props.project.tasks, props.activeSubs, props.activeTeam],
  );

  const subColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of props.project.subprojects) {
      m.set(s.id, paletteColor(s.colorIndex, props.theme));
    }
    return m;
  }, [props.project.subprojects, props.theme]);

  const width = avatarCol + days.length * dayWidth;
  const height = HEADER_HEIGHT + visibleTeam.length * LANE_HEIGHT;

  const todayStr = todayIso();
  const todayDayIndex = days.indexOf(todayStr);
  const todayX = todayDayIndex >= 0 ? avatarCol + todayDayIndex * dayWidth + dayWidth / 2 : -1;

  // Auto-scroll na today při prvním renderu / změně projektu
  useEffect(() => {
    if (todayX > 0 && wrapperRef.current) {
      const w = wrapperRef.current.clientWidth;
      wrapperRef.current.scrollLeft = Math.max(0, todayX - w / 2);
    }
  }, [todayX, props.project.id]);

  // Drag horizontal (pointerevents)
  const dragStateRef = useRef<{ startX: number; scrollLeft: number; isClick: boolean } | null>(null);
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!wrapperRef.current) return;
    // Pokud klik na task block, drag se neaktivuje (TaskBlock handler stopuje propagation)
    dragStateRef.current = {
      startX: e.clientX,
      scrollLeft: wrapperRef.current.scrollLeft,
      isClick: true,
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStateRef.current || !wrapperRef.current) return;
    const delta = e.clientX - dragStateRef.current.startX;
    if (Math.abs(delta) > 5) dragStateRef.current.isClick = false;
    if (!dragStateRef.current.isClick) {
      setIsDragging(true);
      wrapperRef.current.scrollLeft = dragStateRef.current.scrollLeft - delta;
    }
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStateRef.current) {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      dragStateRef.current = null;
    }
    setIsDragging(false);
  }

  return (
    <div className="tv-card" style={{ padding: 0, marginBottom: 12, overflow: "hidden" }}>
      <div
        ref={wrapperRef}
        className={`tv-canvas-wrapper ${isDragging ? "tv-canvas-wrapper--dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg width={width} height={height} style={{ display: "block" }}>
          {/* Weekend background */}
          {days.map((d, i) => isWeekend(d) && (
            <rect
              key={`wk-${d}`}
              x={avatarCol + i * dayWidth}
              y={0}
              width={dayWidth}
              height={height}
              fill="var(--tv-weekend-bg)"
            />
          ))}

          {/* Lane dividers + avatar column */}
          {visibleTeam.map((m, i) => {
            const y = HEADER_HEIGHT + i * LANE_HEIGHT;
            const color = paletteColor(m.colorIndex, props.theme);
            return (
              <g key={`lane-${m.id}`}>
                <line
                  x1={0} y1={y} x2={width} y2={y}
                  stroke="var(--tv-lane-divider)" strokeWidth={1}
                />
                {/* Avatar */}
                <circle
                  cx={avatarCol / 2}
                  cy={y + LANE_HEIGHT / 2}
                  r={isMobile ? 14 : 18}
                  fill={hexA(color, 0.25)}
                  stroke={color}
                  strokeWidth={1}
                />
                <text
                  x={avatarCol / 2}
                  y={y + LANE_HEIGHT / 2 + 4}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={500}
                  fill={color}
                >
                  {m.initial}
                </text>
                {/* Jméno pod avatar */}
                <text
                  x={avatarCol / 2}
                  y={y + LANE_HEIGHT / 2 + (isMobile ? 24 : 30)}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--tv-text-tertiary)"
                >
                  {m.name.length > 12 ? m.name.slice(0, 11) + "…" : m.name}
                </text>
              </g>
            );
          })}

          {/* Header — day labels */}
          {days.map((d, i) => {
            const x = avatarCol + i * dayWidth;
            const date = fromIsoDate(d);
            const dayNum = date.getDate();
            const isToday = d === todayStr;
            const isFirstOfMonth = dayNum === 1;
            return (
              <g key={`hdr-${d}`}>
                {isFirstOfMonth && (
                  <text
                    x={x + 2}
                    y={16}
                    fontSize={11}
                    fontWeight={500}
                    fill="var(--tv-text-secondary)"
                  >
                    {date.toLocaleDateString("cs-CZ", { month: "short", timeZone: "Europe/Prague" })}
                  </text>
                )}
                <text
                  x={x + dayWidth / 2}
                  y={HEADER_HEIGHT - 18}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={isToday ? 500 : 400}
                  fill={isToday ? "var(--tv-today)" : "var(--tv-text)"}
                >
                  {dayNum}
                </text>
                <text
                  x={x + dayWidth / 2}
                  y={HEADER_HEIGHT - 4}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={500}
                  fill="var(--tv-text-tertiary)"
                >
                  {date.toLocaleDateString("cs-CZ", { weekday: "narrow", timeZone: "Europe/Prague" })}
                </text>
              </g>
            );
          })}

          {/* Today line */}
          {todayX > 0 && (
            <>
              <circle cx={todayX} cy={HEADER_HEIGHT} r={4} fill="var(--tv-today)" />
              <line
                x1={todayX} y1={HEADER_HEIGHT}
                x2={todayX} y2={height}
                stroke="var(--tv-today)"
                strokeWidth={1.5}
                strokeDasharray="3,3"
              />
            </>
          )}

          {/* Tasks */}
          {visibleTasks.map((t) => {
            const laneIndex = visibleTeam.findIndex((m) => m.id === t.assigneeId);
            if (laneIndex < 0) return null;
            const dayIdx = days.indexOf(t.startDate);
            if (dayIdx < 0) return null;
            const x = avatarCol + dayIdx * dayWidth + 2;
            const y = HEADER_HEIGHT + laneIndex * LANE_HEIGHT + TASK_VERTICAL_PADDING;
            const w = Math.max(dayWidth * t.durationDays - 4, dayWidth - 4);
            const subColor = subColorMap.get(t.subprojectId) ?? paletteColor(0, props.theme);
            const fillAlpha = props.theme === "light" ? 0.22 : 0.18;
            const isSelected = props.selectedTaskId === t.id;
            return (
              <g
                key={t.id}
                className={`tv-task ${t.completed ? "tv-task--done" : ""} ${isSelected ? "tv-task--selected" : ""}`}
                onPointerDown={(e) => {
                  // Stop drag bubbling — task click ≠ canvas drag
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onSelectTask(t.id);
                }}
              >
                <rect
                  x={x} y={y}
                  width={w} height={TASK_HEIGHT}
                  rx={10}
                  fill={hexA(subColor, fillAlpha)}
                  stroke={isSelected ? subColor : "transparent"}
                  strokeWidth={isSelected ? 2 : 0}
                />
                <rect
                  x={x} y={y}
                  width={3} height={TASK_HEIGHT}
                  rx={1.5}
                  fill={subColor}
                />
                <text
                  x={x + 10}
                  y={y + 18}
                  fontSize={12}
                  fontWeight={500}
                  fill={taskTitleColor(subColor, props.theme)}
                  style={{ pointerEvents: "none" }}
                >
                  {truncate(t.title, Math.floor(w / 7))}
                </text>
                {t.durationDays > 1 && (
                  <text
                    x={x + 10}
                    y={y + 30}
                    fontSize={10}
                    fill={taskTitleColor(subColor, props.theme)}
                    opacity={0.7}
                    style={{ pointerEvents: "none" }}
                  >
                    {t.durationDays}d
                  </text>
                )}
              </g>
            );
          })}

          {/* Milestones — pečetidla nad header */}
          {props.project.milestones.map((m) => {
            if (!props.activeSubs.has(m.subprojectId)) return null;
            const dayIdx = days.indexOf(m.date);
            if (dayIdx < 0) return null;
            const x = avatarCol + dayIdx * dayWidth + dayWidth / 2;
            return (
              <g key={`ms-${m.id}`}>
                <text
                  x={x} y={14}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={500}
                  fill="var(--tv-text-secondary)"
                >
                  {truncate(m.label, 14)}
                </text>
                <circle cx={x} cy={28} r={11} fill="var(--tv-milestone)" />
                <text
                  x={x} y={32}
                  textAnchor="middle"
                  fontSize={14}
                  fontWeight={500}
                  fill="var(--tv-milestone-check)"
                  style={{ pointerEvents: "none" }}
                >
                  ✓
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(1, maxChars - 1)) + "…";
}

// =============================================================================
// Detail — karta s informacemi o vybraném tasku
// =============================================================================
function Detail(props: {
  task: TimelineTask;
  project: TimelineProject;
  theme: Theme;
  onClose: () => void;
}) {
  const sub = props.project.subprojects.find((s) => s.id === props.task.subprojectId);
  const member = props.project.team.find((m) => m.id === props.task.assigneeId);
  const subColor = sub ? paletteColor(sub.colorIndex, props.theme) : null;
  const endIso = addDays(props.task.startDate, props.task.durationDays - 1);

  return (
    <div className="tv-card" style={{ padding: "16px 18px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {subColor && (
          <div style={{
            width: 4, height: 36, borderRadius: 2, background: subColor, flexShrink: 0,
          }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tv-h3" style={{ marginBottom: 4 }}>{props.task.title}</div>
          <div className="tv-caption">
            {sub?.name} · {member?.name} · {props.task.completed ? "✓ hotovo" : "otevřené"}
          </div>
        </div>
        <button
          type="button"
          className="tv-icon-btn"
          onClick={props.onClose}
          aria-label="Zavřít detail"
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px" }}>
        <div className="tv-stat-label">Termín</div>
        <div className="tv-body">
          {formatDateLong(props.task.startDate)}
          {props.task.durationDays > 1 && ` → ${formatDateLong(endIso)} (${props.task.durationDays} dní)`}
        </div>

        {props.task.notes && (
          <>
            <div className="tv-stat-label">Poznámky</div>
            <div className="tv-body" style={{ whiteSpace: "pre-wrap" }}>{props.task.notes}</div>
          </>
        )}
      </div>

      {props.task.todoistUrl && (
        <div style={{ marginTop: 12 }}>
          <a
            href={props.task.todoistUrl}
            target="_blank"
            rel="noreferrer"
            className="tv-chip"
            style={{ textDecoration: "none" }}
          >
            <ExternalLink size={12} /> Otevřít v Todoistu
          </a>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Empty state — projekt bez úkolů s dueAt (Q-G)
// =============================================================================
function EmptyState({ projectId }: { projectId: string }) {
  return (
    <div className="tv-card" style={{ padding: 32, textAlign: "center" }}>
      <div className="tv-h2" style={{ marginBottom: 8 }}>Žádné úkoly s datem</div>
      <div className="tv-body" style={{ color: "var(--tv-text-secondary)", marginBottom: 16 }}>
        Projekt nemá žádné úkoly s termínem. Přidej termín k úkolům v Todoistu — pak se objeví v timeline.
      </div>
      <a
        href={`https://todoist.com/app/project/${projectId}`}
        target="_blank"
        rel="noreferrer"
        className="tv-chip"
        style={{ textDecoration: "none" }}
      >
        <ExternalLink size={12} /> Otevřít projekt v Todoist
      </a>
    </div>
  );
}
