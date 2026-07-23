import { useMemo, useState } from "react";
import { Check, GripVertical, AlertTriangle, Sparkles, Loader2, X, ChevronRight, ChevronDown, Clock } from "lucide-react";
import { Button } from "./ui/Button";

/**
 * Týdenní plánovací board (ADHD F1, redesign 2026-07-23 po Gideonově feedbacku):
 *  - dny = ŘÁDKY pod sebou přes celou šířku (8 sloupců vedle sebe se nevešlo
 *    na desktop a nebylo vidět, který den je který)
 *  - backlog = skupiny po PROJEKTECH (sbalené, s počty) — 1400+ úkolů
 *    v plochém seznamu bylo k ničemu
 *  - hlavička dne ukazuje schůzky s časy z kalendáře — plánuje se kolem nich
 */

export interface PlanCard {
  id: string;
  title: string;
  priority: "low" | "normal" | "high";
  dueAt: string | null;
  plannedFor: string | null; // YYYY-MM-DD
  tags: string[];
  projectName: string | null;
  overdue?: boolean;
}

export interface DayInfo {
  date: string;
  label: string;        // "Po 20. 7."
  dayName: string;      // "Pondělí"
  isToday: boolean;
  isPast: boolean;
  modeName?: string | null;
  modeTint?: string | null;
  modeLabel?: string | null;
  meetings: { time: string; title: string }[];
  busyHours: number;
}

interface Props {
  weekStart: string;
  days: DayInfo[];
  initialCards: PlanCard[];
  backlogTotal: number;
}

const WIP_LIMIT = 3;

function priorityDot(p: PlanCard["priority"]): string {
  if (p === "high") return "var(--c-signal)";
  if (p === "normal") return "var(--tint-butter)";
  return "var(--muted-foreground)";
}

export default function PlanningBoard({ weekStart, days, initialCards, backlogTotal }: Props) {
  const [cards, setCards] = useState<PlanCard[]>(initialCards);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  // ---- AI weekly review ----
  interface Proposal { taskId: string; title: string; date: string; reason: string | null }
  const [aiBusy, setAiBusy] = useState(false);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  async function askAi() {
    setAiBusy(true);
    setError(null);
    setProposals(null);
    try {
      const res = await fetch("/api/planovani/navrh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ week: weekStart }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Návrh selhal."); return; }
      setProposals(data.proposals);
      setAiWarnings(data.warnings ?? []);
      setChecked(new Set((data.proposals as Proposal[]).map((p) => p.taskId)));
    } catch {
      setError("Síťová chyba při AI návrhu.");
    } finally {
      setAiBusy(false);
    }
  }

  async function confirmProposals() {
    if (!proposals) return;
    const chosen = proposals.filter((p) => checked.has(p.taskId));
    if (chosen.length === 0) { setProposals(null); return; }
    setConfirming(true);
    try {
      const res = await fetch("/api/planovani/potvrdit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignments: chosen.map((p) => ({ taskId: p.taskId, date: p.date })) }),
      });
      if (!res.ok) { setError("Potvrzení se nepovedlo."); return; }
      const map = new Map(chosen.map((p) => [p.taskId, p.date]));
      setCards((cs) => cs.map((c) => (map.has(c.id) ? { ...c, plannedFor: map.get(c.id)!, overdue: false } : c)));
      setProposals(null);
    } finally {
      setConfirming(false);
    }
  }

  // ---- data ----
  const backlogCards = useMemo(
    () =>
      cards
        .filter((c) => c.plannedFor === null || c.overdue)
        .filter((c) => !filter || c.title.toLowerCase().includes(filter.toLowerCase()) || c.projectName?.toLowerCase().includes(filter.toLowerCase())),
    [cards, filter],
  );

  // Skupiny po projektech, největší první; přeteklé z minula vždy nahoře zvlášť
  const backlogGroups = useMemo(() => {
    const overdue = backlogCards.filter((c) => c.overdue);
    const rest = backlogCards.filter((c) => !c.overdue);
    const map = new Map<string, PlanCard[]>();
    for (const c of rest) {
      const key = c.projectName ?? "Bez projektu";
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) =>
        ["high", "normal", "low"].indexOf(a.priority) - ["high", "normal", "low"].indexOf(b.priority) ||
        (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
    }
    const groups = [...map.entries()].sort((a, b) => b[1].length - a[1].length);
    return { overdue, groups };
  }, [backlogCards]);

  const byDay = useMemo(() => {
    const map = new Map<string, PlanCard[]>();
    for (const d of days) map.set(d.date, []);
    for (const c of cards) {
      if (c.plannedFor && !c.overdue && map.has(c.plannedFor)) map.get(c.plannedFor)!.push(c);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => ["high", "normal", "low"].indexOf(a.priority) - ["high", "normal", "low"].indexOf(b.priority));
    }
    return map;
  }, [cards, days]);

  // ---- akce ----
  async function move(cardId: string, target: string | null) {
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, plannedFor: target, overdue: false } : c)));
    setError(null);
    const res = await fetch(`/api/ukoly/${cardId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plannedFor: target }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setCards(prev);
      setError("Uložení se nepovedlo — zkus to znovu.");
    }
  }

  async function complete(cardId: string) {
    const prev = cards;
    setCards((cs) => cs.filter((c) => c.id !== cardId));
    const res = await fetch(`/api/ukoly/${cardId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setCards(prev);
      setError("Dokončení se nepovedlo — zkus to znovu.");
    }
  }

  const dayLabelFor = (date: string) => days.find((d) => d.date === date)?.label ?? date;

  // ---- UI kousky ----
  function Card({ c, compact }: { c: PlanCard; compact?: boolean }) {
    const dueBadge = c.dueAt ? new Date(c.dueAt) : null;
    const dueLate = dueBadge && c.plannedFor && dueBadge < new Date(`${c.plannedFor}T00:00:00`);
    const dueMiss = dueBadge && dueBadge < new Date() && !c.plannedFor;
    return (
      <div
        draggable
        onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setDragId(null); setDropTarget(null); }}
        className={`group rounded-md border border-border bg-card px-2 py-1.5 text-sm cursor-grab active:cursor-grabbing ${
          compact ? "w-full sm:w-60" : "w-full"
        } ${dragId === c.id ? "opacity-40" : ""} ${c.overdue ? "border-l-[3px] border-l-[color:var(--c-signal)]" : ""}`}
      >
        <div className="flex items-start gap-1.5">
          <GripVertical className="size-3.5 mt-0.5 shrink-0 text-muted-foreground/40" />
          <span className="flex-1 min-w-0 leading-snug line-clamp-2" title={c.title}>{c.title}</span>
          <button
            type="button"
            onClick={() => complete(c.id)}
            title="Hotovo"
            className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded text-muted-foreground hover:text-[var(--tint-sage)] transition-opacity"
          >
            <Check className="size-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap pl-5 text-[10px] font-mono text-muted-foreground">
          <span className="size-1.5 rounded-full shrink-0" style={{ background: priorityDot(c.priority) }} />
          {c.projectName && <span className="truncate max-w-[8rem]">{c.projectName}</span>}
          {dueBadge && (
            <span className={dueLate || dueMiss ? "text-[color:var(--c-signal)] font-semibold" : ""}>
              do {dueBadge.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" })}
            </span>
          )}
          {c.overdue && <span className="text-[color:var(--c-signal)]">z minula</span>}
          <select
            value=""
            onChange={(e) => { if (e.target.value) move(c.id, e.target.value === "backlog" ? null : e.target.value); }}
            className="ml-auto bg-transparent border border-border rounded px-1 py-0.5 text-[10px] text-muted-foreground"
            title="Přesunout na den"
          >
            <option value="">→ den</option>
            <option value="backlog">Backlog</option>
            {days.map((d) => (
              <option key={d.date} value={d.date}>{d.label}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  function DayRow({ d }: { d: DayInfo }) {
    const cardsIn = byDay.get(d.date) ?? [];
    const over = dropTarget === d.date;
    const wipOver = cardsIn.length > WIP_LIMIT;
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setDropTarget(d.date); }}
        onDragLeave={() => setDropTarget((t) => (t === d.date ? null : t))}
        onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, d.date); setDropTarget(null); }}
        className={`rounded-xl border p-3 transition-colors ${
          over ? "border-[var(--tint-sky)] bg-[var(--tint-sky)]/5" : "border-white/10 bg-black/10"
        } ${d.isToday ? "ring-1 ring-[var(--tint-sky)]/50" : ""} ${d.isPast ? "opacity-60" : ""}`}
      >
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <div className="flex items-baseline gap-2 min-w-[9rem]">
            <span className={`font-serif text-lg ${d.isToday ? "text-[var(--tint-sky)]" : ""}`}>{d.dayName}</span>
            <span className="font-mono text-xs text-muted-foreground tabular">{d.label.split(" ")[1]}</span>
            {d.isToday && <span className="text-[10px] font-mono text-[var(--tint-sky)] uppercase">dnes</span>}
          </div>
          {d.modeName && (
            <span
              className="rounded-md px-2 py-0.5 text-[10px] font-mono"
              style={{
                background: `color-mix(in oklch, var(--tint-${d.modeTint ?? "sky"}) 16%, transparent)`,
                color: `var(--tint-${d.modeTint ?? "sky"})`,
              }}
            >
              {d.modeName}{d.modeLabel ? ` · ${d.modeLabel}` : ""}
            </span>
          )}
          {d.meetings.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground flex-wrap">
              <Clock className="size-3 shrink-0" />
              {d.meetings.map((m, i) => (
                <span key={i} className="whitespace-nowrap">
                  {m.time} {m.title.length > 24 ? `${m.title.slice(0, 23)}…` : m.title}
                  {i < d.meetings.length - 1 ? " ·" : ""}
                </span>
              ))}
              {d.busyHours > 0 && <span className="text-muted-foreground/60">({d.busyHours.toFixed(1)} h)</span>}
            </span>
          )}
          <span className={`ml-auto text-[11px] font-mono ${wipOver ? "text-[color:var(--c-signal)] font-semibold" : "text-muted-foreground"}`}>
            {cardsIn.length}/{WIP_LIMIT}
            {wipOver && <AlertTriangle className="inline size-3 ml-1 -mt-0.5" />}
          </span>
        </div>
        {cardsIn.length === 0 ? (
          <div className="text-xs text-muted-foreground/50 italic px-1 py-1.5">přetáhni sem úkol…</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {cardsIn.map((c) => <Card key={c.id} c={c} compact />)}
          </div>
        )}
      </div>
    );
  }

  function toggleGroup(name: string) {
    setOpenGroups((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={askAi} disabled={aiBusy} variant="outline" size="sm">
          {aiBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {aiBusy ? "Skládám návrh…" : "Navrhnout týden (AI)"}
        </Button>
        <span className="text-xs text-muted-foreground">
          AI rozloží backlog do dnů podle termínů, kapacity a schůzek — ty jen potvrdíš.
        </span>
      </div>

      {error && <div className="text-sm text-[var(--destructive,#e5484d)]">{error}</div>}

      {proposals && (
        <div className="rounded-xl border border-[var(--tint-sky)]/40 bg-[var(--tint-sky)]/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Návrh týdne — {proposals.length} úkolů</span>
            <button type="button" onClick={() => setProposals(null)} className="p-1 rounded text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          {aiWarnings.length > 0 && (
            <ul className="text-xs text-[color:var(--c-signal)] space-y-0.5">
              {aiWarnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}
          {proposals.length === 0 ? (
            <div className="text-sm text-muted-foreground">AI nenašla nic k naplánování.</div>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {proposals.map((p) => (
                <label key={p.taskId} className="flex items-start gap-2 text-sm rounded-md px-2 py-1 bg-black/10 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked.has(p.taskId)}
                    onChange={(e) => setChecked((s) => { const n = new Set(s); if (e.target.checked) n.add(p.taskId); else n.delete(p.taskId); return n; })}
                    className="mt-1"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="font-mono text-xs text-[var(--tint-sky)] mr-2">{dayLabelFor(p.date)}</span>
                    {p.title}
                    {p.reason && <span className="block text-xs text-muted-foreground">{p.reason}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
          {proposals.length > 0 && (
            <div className="flex items-center gap-2">
              <Button onClick={confirmProposals} disabled={confirming} size="sm">
                {confirming ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Potvrdit vybrané ({checked.size})
              </Button>
              <Button onClick={() => setProposals(null)} variant="ghost" size="sm">Zrušit</Button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-3 items-start">
        {/* ---- Backlog: skupiny po projektech ---- */}
        <div className="space-y-1.5 lg:sticky lg:top-2 lg:max-h-[80vh] lg:overflow-y-auto rounded-xl border border-white/10 bg-black/10 p-2">
          <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground px-1 flex items-baseline justify-between">
            <span>K naplánování</span>
            <span>{backlogTotal}</span>
          </div>
          <div className="px-1 text-[10px] text-muted-foreground/70 leading-snug">
            Termín do 14 dnů nebo vysoká priorita — po klientech. Zbytek zůstává v Todoistu.
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Hledat úkol / klienta…"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
          />
          {backlogGroups.overdue.length > 0 && (
            <div className="space-y-1">
              <div className="px-1 text-[10px] font-mono text-[color:var(--c-signal)] uppercase tracking-widest">
                Nedokončeno z minula ({backlogGroups.overdue.length})
              </div>
              {backlogGroups.overdue.map((c) => <Card key={c.id} c={c} />)}
            </div>
          )}
          {backlogGroups.groups.map(([name, groupCards]) => {
            const open = openGroups.has(name) || filter.length > 0;
            return (
              <div key={name}>
                <button
                  type="button"
                  onClick={() => toggleGroup(name)}
                  className="w-full flex items-center gap-1.5 px-1 py-1 text-sm rounded-md hover:bg-white/5 text-left"
                >
                  {open ? <ChevronDown className="size-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />}
                  <span className="flex-1 min-w-0 truncate font-medium">{name}</span>
                  <span className="text-[11px] font-mono text-muted-foreground">{groupCards.length}</span>
                </button>
                {open && (
                  <div className="space-y-1 pl-1 pb-1">
                    {groupCards.map((c) => <Card key={c.id} c={c} />)}
                  </div>
                )}
              </div>
            );
          })}
          {backlogCards.length === 0 && (
            <div className="text-xs text-muted-foreground italic px-1 py-2">Nic nenalezeno.</div>
          )}
          <div
            onDragOver={(e) => { e.preventDefault(); setDropTarget("backlog"); }}
            onDragLeave={() => setDropTarget((t) => (t === "backlog" ? null : t))}
            onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, null); setDropTarget(null); }}
            className={`rounded-md border border-dashed px-2 py-2 text-center text-[11px] font-mono transition-colors ${
              dropTarget === "backlog" ? "border-[var(--tint-sky)] text-[var(--tint-sky)]" : "border-border text-muted-foreground/60"
            }`}
          >
            sem přetáhni pro odplánování
          </div>
        </div>

        {/* ---- Dny jako řádky ---- */}
        <div className="space-y-2 min-w-0">
          {days.map((d) => <DayRow key={d.date} d={d} />)}
        </div>
      </div>
    </div>
  );
}
