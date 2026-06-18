import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  Check,
  Info,
  Lightbulb,
  Library,
  Link2,
  ListTodo,
  Loader2,
  MessageSquareQuote,
  Pencil,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "./ui/Button";

type EntryType = "TASK" | "JOURNAL" | "THOUGHT" | "CONTEXT" | "KNOWLEDGE";
type TaskWhen = "TODAY" | "THIS_WEEK" | "SOMEDAY";
type Entry = {
  id: string;
  type: EntryType;
  text: string;
  rawExcerpt: string | null;
  suggestedProject: string | null;
  suggestedWhen: TaskWhen | null;
  rationale: string | null;
  knowledgeCategory: string | null;
  knowledgeUrl: string | null;
  knowledgeTags: string[];
  status: "PENDING" | "CONFIRMED" | "DISCARDED";
  createdAt: string;
  recording: { id: string; source: string; createdAt: string };
};

const TYPE_META: Record<EntryType, { label: string; icon: typeof ListTodo; tint: string }> = {
  TASK:      { label: "Úkol",      icon: ListTodo,  tint: "peach"    },
  JOURNAL:   { label: "Deník",     icon: BookOpen,  tint: "butter"   },
  THOUGHT:   { label: "Myšlenka",  icon: Lightbulb, tint: "lavender" },
  CONTEXT:   { label: "Kontext",   icon: Info,      tint: "sky"      },
  KNOWLEDGE: { label: "Knowledge", icon: Library,   tint: "mint"     },
};

const WHEN_LABEL: Record<TaskWhen, string> = {
  TODAY: "Dnes",
  THIS_WEEK: "Tento týden",
  SOMEDAY: "Někdy",
};

const PROJECT_SUGGESTIONS = [
  "Osobní", "Tělo", "Syn", "Firma", "Hudba", "Rašeliniště",
  "Domácnost", "Lidé", "Prodej",
];

const KNOWLEDGE_CATEGORIES = [
  "Hudba", "Psychologie", "AI", "Technické", "Obchod", "Zdraví", "Ostatní",
];

function fmtDate(s: string): string {
  return new Date(s).toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TriageList() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showRationale, setShowRationale] = useState<Set<string>>(new Set());
  const [toast, _setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function setToast(t: { type: "ok" | "err"; text: string } | null) {
    _setToast(t);
    if (t) setTimeout(() => _setToast(null), 3200);
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/triage?limit=100");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Načtení selhalo.");
        return;
      }
      setEntries(data.entries);
    } catch {
      setError("Síťová chyba.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function setPending(id: string, on: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function patchEntry(
    id: string,
    patch: Record<string, unknown>
  ): Promise<{ entry: Entry; todoist?: { ok: boolean; error?: string } } | null> {
    setPending(id, true);
    try {
      const res = await fetch(`/api/entries/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Úprava selhala.");
        return null;
      }
      return { entry: data.entry as Entry, todoist: data.todoist };
    } finally {
      setPending(id, false);
    }
  }

  async function confirmEntry(id: string) {
    const result = await patchEntry(id, { status: "CONFIRMED" });
    if (result) {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (result.todoist?.ok) {
        setToast({ type: "ok", text: "Úkol odeslán do Todoistu " });
      } else if (result.todoist && !result.todoist.ok) {
        setToast({ type: "err", text: `Todoist: ${result.todoist.error}` });
      }
    }
  }
  async function discardEntry(id: string) {
    const result = await patchEntry(id, { status: "DISCARDED" });
    if (result) setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  async function updateFields(id: string, patch: Record<string, unknown>) {
    const result = await patchEntry(id, patch);
    if (result) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, ...result.entry, recording: e.recording } : e
        )
      );
      if (result.todoist?.ok) {
        setToast({ type: "ok", text: "Úkol odeslán do Todoistu " });
      } else if (result.todoist && !result.todoist.ok) {
        setToast({ type: "err", text: `Todoist: ${result.todoist.error}` });
      }
    }
  }

  if (loading) {
    return (
      <div className="glass rounded-xl p-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Načítám…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm">{error}</p>
        <Button variant="ghost" size="sm" onClick={refresh} className="mt-2">Zkusit znovu</Button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="glass rounded-xl py-20 text-center">
        <p className="font-serif italic text-2xl text-foreground/90">
          Všechno zpracované.
        </p>
        <p className="font-serif italic text-xl text-muted-foreground mt-1">
          Běž žít.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-md text-sm font-medium shadow-lg ${
            toast.type === "ok"
              ? "bg-[var(--tint-sage)]/90 text-black"
              : "bg-destructive/90 text-destructive-foreground"
          }`}
        >
          {toast.text}
        </div>
      )}
      {entries.map((e) => (
        <EntryCard
          key={e.id}
          entry={e}
          pending={pendingIds.has(e.id)}
          editing={editingId === e.id}
          showRationale={showRationale.has(e.id)}
          onToggleEdit={() => setEditingId(editingId === e.id ? null : e.id)}
          onToggleRationale={() => {
            setShowRationale((prev) => {
              const next = new Set(prev);
              if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
              return next;
            });
          }}
          onSave={(patch) => updateFields(e.id, patch).then(() => setEditingId(null))}
          onConfirm={() => confirmEntry(e.id)}
          onDiscard={() => discardEntry(e.id)}
          onChangeType={(type) => updateFields(e.id, { type })}
        />
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------
function EntryCard({
  entry,
  pending,
  editing,
  showRationale,
  onToggleEdit,
  onToggleRationale,
  onSave,
  onConfirm,
  onDiscard,
  onChangeType,
}: {
  entry: Entry;
  pending: boolean;
  editing: boolean;
  showRationale: boolean;
  onToggleEdit: () => void;
  onToggleRationale: () => void;
  onSave: (patch: Record<string, unknown>) => void;
  onConfirm: () => void;
  onDiscard: () => void;
  onChangeType: (t: EntryType) => void;
}) {
  const meta = TYPE_META[entry.type];
  const TypeIcon = meta.icon;

  const [text, setText] = useState(entry.text);
  const [project, setProject] = useState(entry.suggestedProject ?? "");
  const [when, setWhen] = useState<TaskWhen | "">(entry.suggestedWhen ?? "");
  const [knowledgeCategory, setKnowledgeCategory] = useState(entry.knowledgeCategory ?? "");
  const [knowledgeUrl, setKnowledgeUrl] = useState(entry.knowledgeUrl ?? "");
  const [knowledgeTagsInput, setKnowledgeTagsInput] = useState(
    (entry.knowledgeTags ?? []).join(", ")
  );
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [typeMenuPos, setTypeMenuPos] = useState<{ top: number; left: number } | null>(null);
  const typeMenuBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setText(entry.text);
    setProject(entry.suggestedProject ?? "");
    setWhen(entry.suggestedWhen ?? "");
    setKnowledgeCategory(entry.knowledgeCategory ?? "");
    setKnowledgeUrl(entry.knowledgeUrl ?? "");
    setKnowledgeTagsInput((entry.knowledgeTags ?? []).join(", "));
  }, [
    entry.text,
    entry.suggestedProject,
    entry.suggestedWhen,
    entry.knowledgeCategory,
    entry.knowledgeUrl,
    entry.knowledgeTags,
  ]);

  const isTask = entry.type === "TASK";
  const isKnowledge = entry.type === "KNOWLEDGE";

  function parseTags(input: string): string[] {
    return input
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 10);
  }

  function buildPatchAndConfirm() {
    const patch: Record<string, unknown> = {};
    if (text !== entry.text) patch.text = text;

    if (isTask) {
      const proj = project.trim() || null;
      if (proj !== entry.suggestedProject) patch.suggestedProject = proj;
      const w = when === "" ? null : when;
      if (w !== entry.suggestedWhen) patch.suggestedWhen = w;
    }

    if (isKnowledge) {
      const cat = knowledgeCategory.trim() || null;
      if (cat !== entry.knowledgeCategory) patch.knowledgeCategory = cat;
      const url = knowledgeUrl.trim() || null;
      if (url !== entry.knowledgeUrl) patch.knowledgeUrl = url;
      const newTags = parseTags(knowledgeTagsInput);
      const oldTags = entry.knowledgeTags ?? [];
      const tagsChanged =
        newTags.length !== oldTags.length ||
        newTags.some((t, i) => t !== oldTags[i]);
      if (tagsChanged) patch.knowledgeTags = newTags;
    }

    if (Object.keys(patch).length > 0) {
      onSave({ ...patch, status: "CONFIRMED" });
    } else {
      onConfirm();
    }
  }

  return (
    <article
      className="glass-subtle rounded-xl p-4"
      style={{ ["--c" as string]: `var(--tint-${meta.tint})` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="size-9 rounded-md grid place-items-center shrink-0 mt-0.5"
          style={{ background: "color-mix(in oklch, var(--c) 16%, transparent)", color: "var(--c)" }}
        >
          <TypeIcon className="size-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[10px] uppercase tracking-[0.18em] font-mono font-serif"
              style={{ color: "var(--c)" }}
            >
              {meta.label}
            </span>
            <span className="text-xs text-muted-foreground font-mono tabular">
              {fmtDate(entry.recording.createdAt)} · {entry.recording.source.toLowerCase()}
            </span>
            {entry.rationale && (
              <button
                type="button"
                onClick={onToggleRationale}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                title="Proč to Gemini takhle navrhla"
              >
                <MessageSquareQuote className="size-3" />
                {showRationale ? "skrýt důvod" : "proč?"}
              </button>
            )}
          </div>

          {/* Text */}
          {editing ? (
            <textarea
              className="mt-2 w-full min-h-[80px] rounded-md border border-border bg-input/40 px-3 py-2 text-[15px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              autoFocus
              disabled={pending}
            />
          ) : (
            <p
              className="mt-1.5 text-[15px] leading-relaxed text-foreground whitespace-pre-wrap break-words cursor-text"
              onClick={onToggleEdit}
              title="Klikni pro úpravu"
            >
              {entry.text}
            </p>
          )}

          {entry.rawExcerpt && (
            <p className="mt-1 text-xs text-muted-foreground italic font-serif">
              „{entry.rawExcerpt}"
            </p>
          )}

          {/* TASK-specific fields */}
          {isTask && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
                  Projekt
                </span>
                <input
                  type="text"
                  list={`project-suggestions-${entry.id}`}
                  value={project}
                  onChange={(ev) => setProject(ev.target.value)}
                  disabled={pending}
                  placeholder="např. Osobní, Firma…"
                  className="flex h-9 w-full rounded-md border border-border bg-input/40 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
                <datalist id={`project-suggestions-${entry.id}`}>
                  {PROJECT_SUGGESTIONS.map((p) => <option key={p} value={p} />)}
                </datalist>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
                  Kdy
                </span>
                <select
                  value={when}
                  onChange={(ev) => setWhen(ev.target.value as TaskWhen | "")}
                  disabled={pending}
                  className="flex h-9 w-full rounded-md border border-border bg-input/40 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <option value="">—</option>
                  <option value="TODAY">{WHEN_LABEL.TODAY}</option>
                  <option value="THIS_WEEK">{WHEN_LABEL.THIS_WEEK}</option>
                  <option value="SOMEDAY">{WHEN_LABEL.SOMEDAY}</option>
                </select>
              </label>
            </div>
          )}

          {/* KNOWLEDGE-specific fields */}
          {isKnowledge && (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
                    Kategorie
                  </span>
                  <input
                    type="text"
                    list={`knowledge-categories-${entry.id}`}
                    value={knowledgeCategory}
                    onChange={(ev) => setKnowledgeCategory(ev.target.value)}
                    disabled={pending}
                    placeholder="Hudba, Technické, …"
                    className="flex h-9 w-full rounded-md border border-border bg-input/40 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                  <datalist id={`knowledge-categories-${entry.id}`}>
                    {KNOWLEDGE_CATEGORIES.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono flex items-center gap-1">
                    <Link2 className="size-3" /> URL / Zdroj
                  </span>
                  <input
                    type="text"
                    value={knowledgeUrl}
                    onChange={(ev) => setKnowledgeUrl(ev.target.value)}
                    disabled={pending}
                    placeholder="https://… nebo název platformy"
                    className="flex h-9 w-full rounded-md border border-border bg-input/40 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                </label>
              </div>
              <label className="space-y-1 block">
                <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono flex items-center gap-1">
                  <Tag className="size-3" /> Tagy (oddělené čárkou)
                </span>
                <input
                  type="text"
                  value={knowledgeTagsInput}
                  onChange={(ev) => setKnowledgeTagsInput(ev.target.value)}
                  disabled={pending}
                  placeholder="fingerstyle, Tommy Emmanuel, tutoriál"
                  className="flex h-9 w-full rounded-md border border-border bg-input/40 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
                {!editing && entry.knowledgeTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {entry.knowledgeTags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
                        style={{
                          background: "color-mix(in oklch, var(--c) 14%, transparent)",
                          color: "var(--c)",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </label>
            </div>
          )}

          {showRationale && entry.rationale && (
            <div
              className="mt-3 rounded-md border px-3 py-2 text-xs text-muted-foreground"
              style={{
                background: "color-mix(in oklch, var(--c) 8%, transparent)",
                borderColor: "color-mix(in oklch, var(--c) 25%, transparent)",
              }}
            >
              {entry.rationale}
            </div>
          )}

          {/* Akce */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={buildPatchAndConfirm} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              Potvrdit
            </Button>

            {/* Změnit typ — všech 5 typů. Portal nutný kvůli glass parent
                stacking context (backdrop-filter láme z-index). Pattern z
                memory feedback_calendar_fixed_positioning.md. */}
            <Button
              ref={typeMenuBtnRef}
              size="sm"
              variant="outline"
              onClick={() => {
                if (typeMenuOpen) {
                  setTypeMenuOpen(false);
                  return;
                }
                const rect = typeMenuBtnRef.current?.getBoundingClientRect();
                if (rect) {
                  setTypeMenuPos({
                    top: rect.bottom + 4,
                    left: Math.max(8, Math.min(rect.left, window.innerWidth - 180 - 8)),
                  });
                }
                setTypeMenuOpen(true);
              }}
              disabled={pending}
            >
              <Pencil /> Změnit typ
            </Button>
            {typeMenuOpen && typeMenuPos && typeof document !== "undefined" && createPortal(
              <>
                <div className="fixed inset-0 z-[100]" onClick={() => setTypeMenuOpen(false)} />
                <div
                  className="fixed z-[101] glass-strong rounded-md py-1 min-w-[160px]"
                  style={{ top: typeMenuPos.top, left: typeMenuPos.left }}
                >
                  {(Object.keys(TYPE_META) as EntryType[]).map((t) => {
                    const M = TYPE_META[t];
                    const Icon = M.icon;
                    return (
                      <button
                        key={t}
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-white/10 disabled:opacity-40"
                        disabled={t === entry.type || pending}
                        onClick={() => {
                          setTypeMenuOpen(false);
                          onChangeType(t);
                        }}
                      >
                        <Icon className="size-4" style={{ color: `var(--tint-${M.tint})` }} />
                        {M.label}
                      </button>
                    );
                  })}
                </div>
              </>,
              document.body,
            )}

            {editing && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { onToggleEdit(); setText(entry.text); }}
                disabled={pending}
              >
                <X /> Zrušit úpravu
              </Button>
            )}

            <div className="ml-auto">
              <Button size="sm" variant="ghost" onClick={onDiscard} disabled={pending}>
                <Trash2 /> Zahodit
              </Button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
