import { useMemo, useState } from "react";
import { Check, GripVertical, AlertTriangle, Sparkles, Loader2, X } from "lucide-react";
import { Button } from "./ui/Button";

/**
 * Týdenní plánovací board (Petr 2026-07-22, ADHD F1).
 * Execution date ≠ deadline: karta úkolu se přetáhne na den, KDY se bude
 * dělat (Task.plannedFor). Backlog vlevo = otevřené nenaplánované úkoly.
 * WIP doporučení: max 3 na den — překročení se zvýrazní.
 *
 * Desktop: drag & drop. Mobil: select na kartě.
 */

export interface PlanCard {
  id: string;
  title: string;
  priority: "low" | "normal" | "high";
  dueAt: string | null;
  plannedFor: string | null; // YYYY-MM-DD
  tags: string[];
  projectName: string | null;
  overdue?: boolean; // naplánováno před tímto týdnem a nedodělané
}

interface Props {
  weekStart: string;                 // pondělí YYYY-MM-DD
  days: { date: string; label: string; isToday: boolean }[];
  initialCards: PlanCard[];
  backlogTotal: number;              // celkový počet v backlogu (cap v SSR)
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
  const [dropTarget, setDropTarget] = useState<string | null>(null); // date | "backlog"
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Weekly review AI (F2): návrhy plannedFor k potvrzení
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
      // Lokálně přesuň karty na navržené dny
      const map = new Map(chosen.map((p) => [p.taskId, p.date]));
      setCards((cs) => cs.map((c) => (map.has(c.id) ? { ...c, plannedFor: map.get(c.id)!, overdue: false } : c)));
      setProposals(null);
    } finally {
      setConfirming(false);
    }
  }

  const todayKey = days.find((d) => d.isToday)?.date;

  const backlog = useMemo(
    () =>
      cards
        .filter((c) => c.plannedFor === null || c.overdue)
        .filter((c) => !filter || c.title.toLowerCase().includes(filter.toLowerCase()) || c.projectName?.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) =>
          (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) ||
          ["high", "normal", "low"].indexOf(a.priority) - ["high", "normal", "low"].indexOf(b.priority) ||
          (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999")),
    [cards, filter],
  );

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

  function Card({ c }: { c: PlanCard }) {
    const dueBadge = c.dueAt ? new Date(c.dueAt) : null;
    const dueLate = dueBadge && c.plannedFor && dueBadge < new Date(`${c.plannedFor}T00:00:00`);
    const dueMiss = dueBadge && dueBadge < new Date() && !c.plannedFor;
    return (
      <div
        draggable
        onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setDragId(null); setDropTarget(null); }}
        className={`group rounded-md border border-border bg-card px-2 py-1.5 text-sm cursor-grab active:cursor-grabbing space-y-1 ${
          dragId === c.id ? "opacity-40" : ""
        } ${c.overdue ? "border-l-[3px] border-l-[color:var(--c-signal)]" : ""}`}
      >
        <div className="flex items-start gap-1.5">
          <GripVertical className="size-3.5 mt-0.5 shrink-0 text-muted-foreground/40" />
          <span className="flex-1 min-w-0 leading-snug">{c.title}</span>
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
          {c.projectName && <span className="truncate max-w-[9rem]">{c.projectName}</span>}
          {dueBadge && (
            <span className={dueLate || dueMiss ? "text-[color:var(--c-signal)] font-semibold" : ""}>
              do {dueBadge.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" })}
            </span>
          )}
          {c.overdue && <span className="text-[color:var(--c-signal)]">nedokončeno z minula</span>}
          {/* Mobil fallback: výběr dne bez dragu */}
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

  function Column({ id, title, cardsIn, highlight, subtitle }: {
    id: string; title: string; cardsIn: PlanCard[]; highlight?: boolean; subtitle?: string;
  }) {
    const over = dropTarget === id;
    const wipOver = id !== "backlog" && cardsIn.length > WIP_LIMIT;
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setDropTarget(id); }}
        onDragLeave={() => setDropTarget((t) => (t === id ? null : t))}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId) move(dragId, id === "backlog" ? null : id);
          setDropTarget(null);
        }}
        className={`rounded-xl p-2 flex flex-col gap-1.5 min-h-[10rem] border transition-colors ${
          over ? "border-[var(--tint-sky)] bg-[var(--tint-sky)]/5" : "border-white/5 bg-black/10"
        } ${highlight ? "ring-1 ring-[var(--tint-sky)]/40" : ""}`}
      >
        <div className="flex items-baseline justify-between px-1">
          <span className={`text-[11px] uppercase tracking-widest font-mono ${highlight ? "text-[var(--tint-sky)]" : "text-muted-foreground"}`}>
            {title}
          </span>
          <span className={`text-[10px] font-mono ${wipOver ? "text-[color:var(--c-signal)] font-semibold" : "text-muted-foreground"}`}>
            {cardsIn.length}{id !== "backlog" && `/${WIP_LIMIT}`}
          </span>
        </div>
        {subtitle && <div className="px-1 text-[10px] text-muted-foreground -mt-1">{subtitle}</div>}
        {wipOver && (
          <div className="flex items-center gap-1 px-1 text-[10px] text-[color:var(--c-signal)]">
            <AlertTriangle className="size-3" /> víc než {WIP_LIMIT} — zvaž přesun
          </div>
        )}
        {cardsIn.map((c) => <Card key={c.id} c={c} />)}
      </div>
    );
  }

  const dayLabelFor = (date: string) => days.find((d) => d.date === date)?.label ?? date;

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
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,1fr)_repeat(7,minmax(150px,1fr))] gap-2 items-start">
        <div className="space-y-1.5">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Hledat v backlogu (${backlogTotal})…`}
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
          />
          <Column id="backlog" title="Backlog" cardsIn={backlog} />
        </div>
        {days.map((d) => (
          <Column
            key={d.date}
            id={d.date}
            title={d.label}
            cardsIn={byDay.get(d.date) ?? []}
            highlight={d.isToday}
            subtitle={d.isToday && todayKey ? "dnes" : undefined}
          />
        ))}
      </div>
    </div>
  );
}
