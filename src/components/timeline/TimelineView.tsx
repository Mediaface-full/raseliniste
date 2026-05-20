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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Moon, Sun, Calendar, ExternalLink, X, Printer, Share2, Copy, Check, ChevronDown } from "lucide-react";
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
const DAY_WIDTH: Record<Zoom, number> = { week: 60, month: 30, quarter: 15, year: 5 };
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
  /** F4: read-only view pro share link — skryje sub-projekt/team filter,
   *  theme toggle, action buttons. Default false. */
  readOnly?: boolean;
  /** F4: pokud readOnly, project je předaný ze serveru (žádné /api/timeline calls). */
  initialProject?: TimelineProject;
}

export default function TimelineView({ initialProjectId, readOnly = false, initialProject }: Props) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [options, setOptions] = useState<TimelineProjectOption[]>([]);
  // Petr 2026-05-20: multi-select — pole IDs (1 = single, >1 = aggregate).
  // initialProjectId / initialProject.id může být comma-separated nebo "folder:X".
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const raw = initialProjectId ?? initialProject?.id ?? null;
    if (!raw) return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  });
  const [project, setProject] = useState<TimelineProject | null>(initialProject ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>("month");
  const [activeSubs, setActiveSubs] = useState<Set<string>>(
    new Set(initialProject?.subprojects.map((s) => s.id) ?? []),
  );
  const [activeTeam, setActiveTeam] = useState<Set<string>>(
    new Set(initialProject?.team.map((t) => t.id) ?? []),
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // F4: share modal
  const [shareOpen, setShareOpen] = useState(false);

  // Init theme — readOnly mode default light pro klienta
  useEffect(() => {
    if (readOnly) {
      setTheme("light");
    } else {
      setTheme(detectInitialTheme());
    }
  }, [readOnly]);

  // F2: keyboard navigation — Esc zavře detail
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedTaskId) {
        setSelectedTaskId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedTaskId]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    persistTheme(next);
  }

  // Load project options — pouze pokud NOT readOnly (share view nepoužívá dropdown)
  useEffect(() => {
    if (readOnly) return;
    fetch("/api/timeline/list")
      .then((r) => r.json())
      .then((data) => {
        const opts: TimelineProjectOption[] = data.options ?? [];
        setOptions(opts);
        if (selectedIds.length === 0 && opts.length > 0) {
          // Prefer Team projekt, fallback první
          const firstTeam = opts.find((o) => o.isTeamProject);
          setSelectedIds([firstTeam?.id ?? opts[0]!.id]);
        }
      })
      .catch((e) => setError(`Načtení projektů selhalo: ${e?.message ?? e}`));
  }, [readOnly]);

  // Load selected projects — comma-separated když je víc
  useEffect(() => {
    if (readOnly) return;
    if (selectedIds.length === 0) return;
    setLoading(true);
    setError(null);
    const idsParam = selectedIds.join(",");
    fetch(`/api/timeline/${encodeURIComponent(idsParam)}`)
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
  }, [selectedIds.join(","), readOnly]);

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

  function handlePrint() {
    window.print();
  }

  return (
    <div className={`timeline-view ${readOnly ? "tv-readonly" : ""}`} data-theme={theme}>
      <h2 className="sr-only">
        Project Timeline View{project ? ` — ${project.name}` : ""}
        {stats ? ` — ${stats.visibleTasksCount} úkolů, ${stats.donePct}% hotovo` : ""}
      </h2>

      {error && (
        <div className="tv-card" style={{ padding: 12, marginBottom: 12, color: "var(--tv-today)" }}>
          ⚠ {error}
        </div>
      )}

      <Hero
        options={options}
        selectedIds={selectedIds}
        onSelectChange={setSelectedIds}
        project={project}
        loading={loading}
        stats={stats}
        theme={theme}
        onToggleTheme={toggleTheme}
        zoom={zoom}
        onZoomChange={setZoom}
        readOnly={readOnly}
        onPrint={handlePrint}
        onShareOpen={() => setShareOpen(true)}
      />

      {project && (
        <>
          {!readOnly && (
            <Filters
              project={project}
              activeSubs={activeSubs}
              activeTeam={activeTeam}
              onToggleSub={toggleSub}
              onToggleTeam={toggleTeam}
              theme={theme}
            />
          )}

          {project.tasks.length === 0 && project.milestones.length === 0 ? (
            <EmptyState projectId={project.id} readOnly={readOnly} />
          ) : (
            <Canvas
              project={project}
              activeSubs={activeSubs}
              activeTeam={activeTeam}
              zoom={zoom}
              theme={theme}
              selectedTaskId={selectedTaskId}
              onSelectTask={setSelectedTaskId}
              readOnly={readOnly}
              onTaskMoved={(taskId, newStartDate) => {
                // F5: optimistic update + API call
                setProject((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    tasks: prev.tasks.map((t) =>
                      t.id === taskId ? { ...t, startDate: newStartDate } : t,
                    ),
                  };
                });
                fetch(`/api/timeline/task/${taskId}/move`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ startDate: newStartDate }),
                }).then((r) => {
                  if (!r.ok) {
                    setError(`Přesun úkolu selhal — refresh stránky pro reload.`);
                  }
                });
              }}
            />
          )}

          {selectedTask && (
            <Detail
              task={selectedTask}
              project={project}
              theme={theme}
              onClose={() => setSelectedTaskId(null)}
              readOnly={readOnly}
            />
          )}

          <div className="tv-print-footer">
            Generated by Rašeliniště · {project.name} · {new Date().toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Prague" })}
          </div>
        </>
      )}

      {shareOpen && project && !readOnly && (
        <ShareModal
          project={project}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

// =============================================================================
// Hero — project select + stats + theme toggle + zoom
// =============================================================================
function Hero(props: {
  options: TimelineProjectOption[];
  selectedIds: string[];
  onSelectChange: (ids: string[]) => void;
  project: TimelineProject | null;
  loading: boolean;
  stats: { visibleTasksCount: number; doneCount: number; donePct: number; days: number; teamCount: number } | null;
  theme: Theme;
  onToggleTheme: () => void;
  zoom: Zoom;
  onZoomChange: (z: Zoom) => void;
  readOnly: boolean;
  onPrint: () => void;
  onShareOpen: () => void;
}) {
  return (
    <div className="tv-card" style={{ padding: "18px 20px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <Calendar size={20} style={{ color: "var(--tv-text-secondary)" }} aria-hidden="true" />
        {!props.readOnly && (
          <ProjectMultiSelect
            options={props.options}
            selectedIds={props.selectedIds}
            onChange={props.onSelectChange}
            disabled={props.loading}
          />
        )}
        {props.project && <h1 className="tv-h1" style={{ margin: 0 }}>{props.project.name}</h1>}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }} className="tv-no-print">
          <SegmentedControl value={props.zoom} onChange={props.onZoomChange} />
          {!props.readOnly && (
            <>
              <button
                className="tv-icon-btn"
                onClick={props.onPrint}
                aria-label="Export do PDF"
                title="Export do PDF (browser print dialog)"
              >
                <Printer size={16} aria-hidden="true" />
              </button>
              <button
                className="tv-icon-btn"
                onClick={props.onShareOpen}
                aria-label="Sdílet projekt klientovi"
                title="Sdílet projekt klientovi"
              >
                <Share2 size={16} aria-hidden="true" />
              </button>
            </>
          )}
          <button
            className="tv-icon-btn"
            onClick={props.onToggleTheme}
            aria-label={props.theme === "dark" ? "Přepnout na světlý motiv" : "Přepnout na tmavý motiv"}
            title={props.theme === "dark" ? "Světlý motiv" : "Tmavý motiv"}
          >
            {props.theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
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

/**
 * Multi-select dropdown pro projekty (Petr 2026-05-20).
 * Checkboxy uvnitř pop-overu. Trigger zobrazí "N vybráno" nebo seznam.
 */
function ProjectMultiSelect({
  options,
  selectedIds,
  onChange,
  disabled,
}: {
  options: TimelineProjectOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Zavřít kliknutím mimo
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!open) return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selectedSet = new Set(selectedIds);
  const selectedOptions = options.filter((o) => selectedSet.has(o.id));

  function toggle(id: string) {
    if (selectedSet.has(id)) {
      // Zákaz odebrat poslední — musí být aspoň jeden
      if (selectedIds.length <= 1) return;
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  const triggerLabel = selectedOptions.length === 0
    ? "Vybrat projekt"
    : selectedOptions.length === 1
      ? selectedOptions[0]!.name
      : `${selectedOptions.length} projektů vybráno`;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Vybrat projekty"
        className="tv-select"
        style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: disabled ? "wait" : "pointer", minWidth: 200 }}
      >
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {triggerLabel}
        </span>
        <ChevronDown size={14} style={{ opacity: 0.6, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="tv-card"
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0,
            minWidth: 260, maxHeight: 360, overflowY: "auto",
            padding: 6, zIndex: 100,
          }}
        >
          {options.length === 0 && (
            <div style={{ padding: 12, color: "var(--tv-text-tertiary)", fontSize: 13 }}>
              Žádné projekty
            </div>
          )}
          {options.map((o) => {
            const checked = selectedSet.has(o.id);
            return (
              <label
                key={o.id}
                role="option"
                aria-selected={checked}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 8px", borderRadius: 8, cursor: "pointer",
                  background: checked ? "var(--tv-glass-inner-bg)" : "transparent",
                }}
                onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = "var(--tv-glass-inner-bg)"; }}
                onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = "transparent"; }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(o.id)}
                  style={{ margin: 0, cursor: "pointer" }}
                />
                <span style={{ flex: 1, fontSize: 13 }}>
                  {o.name}
                  {o.isParent && o.subprojectCount > 1 && (
                    <span style={{ color: "var(--tv-text-tertiary)", marginLeft: 6 }}>
                      ({o.subprojectCount})
                    </span>
                  )}
                </span>
                {o.isTeamProject && (
                  <span title="Team Workspace" style={{ color: "var(--tv-text-tertiary)", fontSize: 11 }}>✦</span>
                )}
              </label>
            );
          })}
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
    { v: "year", label: "Rok" },
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
  readOnly: boolean;
  onTaskMoved?: (taskId: string, newStartDate: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // F5: drag task — id taskId, offset px relativní k task start
  const [taskDragState, setTaskDragState] = useState<{
    taskId: string;
    originalStart: string;
    deltaDays: number;
  } | null>(null);
  // F5: pinch zoom (2 fingers)
  const pinchRef = useRef<{ initialDistance: number; initialZoom: Zoom } | null>(null);

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
            // F5: apply drag offset
            const displayStart = taskDragState?.taskId === t.id
              ? addDays(taskDragState.originalStart, taskDragState.deltaDays)
              : t.startDate;
            const dayIdx = days.indexOf(displayStart);
            if (dayIdx < 0) return null;
            const x = avatarCol + dayIdx * dayWidth + 2;
            const y = HEADER_HEIGHT + laneIndex * LANE_HEIGHT + TASK_VERTICAL_PADDING;
            const w = Math.max(dayWidth * t.durationDays - 4, dayWidth - 4);
            const subColor = subColorMap.get(t.subprojectId) ?? paletteColor(0, props.theme);
            const fillAlpha = props.theme === "light" ? 0.22 : 0.18;
            const isSelected = props.selectedTaskId === t.id;
            const isDraggingThis = taskDragState?.taskId === t.id;
            return (
              <g
                key={t.id}
                className={`tv-task ${t.completed ? "tv-task--done" : ""} ${isSelected ? "tv-task--selected" : ""} ${isDraggingThis ? "tv-task--dragging" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`Úkol ${t.title}, ${formatDateLong(displayStart)}${t.durationDays > 1 ? `, ${t.durationDays} dní` : ""}${t.completed ? ", hotovo" : ""}`}
                aria-pressed={isSelected}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    props.onSelectTask(t.id);
                  }
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  // F5: drag úkolu — jen pokud NOT readOnly a držíme déle než ~150 ms
                  if (props.readOnly || !props.onTaskMoved) return;
                  const startClientX = e.clientX;
                  const originalStart = t.startDate;
                  let hasMoved = false;
                  let pendingDelta = 0;
                  const target = e.currentTarget as SVGGElement;
                  target.setPointerCapture(e.pointerId);

                  const onMove = (ev: PointerEvent) => {
                    const deltaPx = ev.clientX - startClientX;
                    const deltaDays = Math.round(deltaPx / dayWidth);
                    if (Math.abs(deltaPx) > 5) hasMoved = true;
                    if (deltaDays !== pendingDelta) {
                      pendingDelta = deltaDays;
                      setTaskDragState({ taskId: t.id, originalStart, deltaDays });
                    }
                  };
                  const onUp = (ev: PointerEvent) => {
                    target.removeEventListener("pointermove", onMove);
                    target.removeEventListener("pointerup", onUp);
                    target.removeEventListener("pointercancel", onUp);
                    try { target.releasePointerCapture(ev.pointerId); } catch {}
                    if (hasMoved && pendingDelta !== 0) {
                      const newStart = addDays(originalStart, pendingDelta);
                      props.onTaskMoved!(t.id, newStart);
                    } else if (!hasMoved) {
                      props.onSelectTask(t.id);
                    }
                    setTaskDragState(null);
                  };
                  target.addEventListener("pointermove", onMove);
                  target.addEventListener("pointerup", onUp);
                  target.addEventListener("pointercancel", onUp);
                }}
                onClick={(e) => {
                  // V readOnly: klik = select. V editable režimu řeší pointerdown.
                  if (props.readOnly) {
                    e.stopPropagation();
                    props.onSelectTask(t.id);
                  }
                }}
              >
                <title>{t.title} — {formatDateLong(displayStart)}{t.durationDays > 1 ? ` (${t.durationDays} dní)` : ""}</title>
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

          {/* Milestones — pečetidla nad header (F2: hover tooltip přes <title>) */}
          {props.project.milestones.map((m) => {
            if (!props.activeSubs.has(m.subprojectId)) return null;
            const dayIdx = days.indexOf(m.date);
            if (dayIdx < 0) return null;
            const x = avatarCol + dayIdx * dayWidth + dayWidth / 2;
            return (
              <g
                key={`ms-${m.id}`}
                role="img"
                aria-label={`Milestone ${m.label} dne ${formatDateLong(m.date)}`}
                tabIndex={0}
              >
                <title>{m.label} — {formatDateLong(m.date)}</title>
                <text
                  x={x} y={14}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={500}
                  fill="var(--tv-text-secondary)"
                >
                  {truncate(m.label, 14)}
                </text>
                <circle cx={x} cy={28} r={11} fill="var(--tv-milestone)" stroke="var(--tv-milestone-check)" strokeWidth={0.5} />
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
  readOnly?: boolean;
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

      {props.task.todoistUrl && !props.readOnly && (
        <div style={{ marginTop: 12 }} className="tv-no-print">
          <a
            href={props.task.todoistUrl}
            target="_blank"
            rel="noreferrer"
            className="tv-chip"
            style={{ textDecoration: "none" }}
          >
            <ExternalLink size={12} aria-hidden="true" /> Otevřít v Todoistu
          </a>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Empty state — projekt bez úkolů s dueAt (Q-G)
// =============================================================================
function EmptyState({ projectId, readOnly }: { projectId: string; readOnly?: boolean }) {
  return (
    <div className="tv-card" style={{ padding: 32, textAlign: "center" }}>
      <div className="tv-h2" style={{ marginBottom: 8 }}>Žádné úkoly s datem</div>
      <div className="tv-body" style={{ color: "var(--tv-text-secondary)", marginBottom: 16 }}>
        {readOnly
          ? "Tento projekt zatím nemá žádné úkoly s termínem."
          : "Projekt nemá žádné úkoly s termínem. Přidej termín k úkolům v Todoistu — pak se objeví v timeline."}
      </div>
      {!readOnly && (
        <a
          href={`https://todoist.com/app/project/${projectId}`}
          target="_blank"
          rel="noreferrer"
          className="tv-chip"
          style={{ textDecoration: "none" }}
        >
          <ExternalLink size={12} aria-hidden="true" /> Otevřít projekt v Todoist
        </a>
      )}
    </div>
  );
}

// =============================================================================
// F4: Share modal — vytvoří public share link s expiry
// =============================================================================
function ShareModal({ project, onClose }: { project: TimelineProject; onClose: () => void }) {
  const [expiryDays, setExpiryDays] = useState(30);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function createShare() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/timeline/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, expiryDays }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Vytvoření selhalo.");
        return;
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setShareUrl(`${origin}/share/${data.token}`);
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback — focus + select
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "grid", placeItems: "center", zIndex: 1000, padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="tv-card"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 24, maxWidth: 520, width: "100%" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
          <Share2 size={20} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <h2 id="share-title" className="tv-h2" style={{ margin: 0 }}>Sdílet projekt klientovi</h2>
            <div className="tv-caption">{project.name}</div>
          </div>
          <button className="tv-icon-btn" onClick={onClose} aria-label="Zavřít">
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="tv-body" style={{ marginBottom: 16 }}>
          Vygeneruje veřejný odkaz pro klienta — read-only verze timeline, bez loginu.
          Klient nevidí filter chipy, theme toggle, ani odkaz do Todoistu.
        </div>

        <div style={{ marginBottom: 12 }}>
          <label className="tv-stat-label" style={{ display: "block", marginBottom: 4 }}>
            Platnost (dní)
          </label>
          <input
            type="number"
            value={expiryDays}
            onChange={(e) => setExpiryDays(Math.max(1, Math.min(365, parseInt(e.target.value || "30", 10))))}
            min={1}
            max={365}
            className="tv-select"
            style={{ width: 100 }}
            disabled={busy || !!shareUrl}
          />
          <span className="tv-caption" style={{ marginLeft: 8 }}>
            (1–365 dní, default 30)
          </span>
        </div>

        {!shareUrl && (
          <button
            type="button"
            onClick={createShare}
            disabled={busy}
            className="tv-chip"
            style={{ cursor: busy ? "wait" : "pointer", padding: "8px 16px" }}
          >
            {busy ? "Vytvářím..." : "Vytvořit odkaz"}
          </button>
        )}

        {shareUrl && (
          <div style={{ marginTop: 12 }}>
            <label className="tv-stat-label" style={{ display: "block", marginBottom: 4 }}>
              Odkaz pro klienta
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={shareUrl}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                className="tv-select"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={copyUrl}
                className="tv-chip"
                style={{ padding: "8px 12px" }}
              >
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copied ? "Zkopírováno" : "Kopírovat"}
              </button>
            </div>
            <div className="tv-caption" style={{ marginTop: 8 }}>
              Odkaz vyprší za {expiryDays} dní. Po vypršení vrátí 404.
            </div>
          </div>
        )}

        {error && (
          <div className="tv-body" style={{ marginTop: 12, color: "var(--tv-today)" }}>
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  );
}
