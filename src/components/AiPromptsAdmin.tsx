import { useState, useEffect } from "react";
import {
  Loader2, Save, RotateCcw, Check, AlertTriangle, Edit3, X, Eye,
} from "lucide-react";
import { Button } from "./ui/Button";

interface PromptItem {
  module: string;
  label: string;
  description: string;
  tint: string;
  current: string;
  default: string;
  isCustom: boolean;
  updatedAt: string | null;
}

export default function AiPromptsAdmin() {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingModule, setEditingModule] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDefault, setShowDefault] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/ai-prompts");
      if (res.ok) {
        const data = await res.json();
        setPrompts(data.prompts);
      }
    } finally {
      setLoading(false);
    }
  }

  function startEdit(p: PromptItem) {
    setEditingModule(p.module);
    setEditContent(p.current);
    setError(null);
    setSuccess(null);
  }

  function cancelEdit() {
    setEditingModule(null);
    setEditContent("");
  }

  async function save(module: string) {
    setBusy(module);
    setError(null);
    try {
      const res = await fetch(`/api/settings/ai-prompts/${module}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Uložení selhalo.");
        return;
      }
      setSuccess(`✓ Uloženo: ${module}`);
      setTimeout(() => setSuccess(null), 4000);
      cancelEdit();
      void load();
    } finally {
      setBusy(null);
    }
  }

  async function reset(module: string, label: string) {
    if (!confirm(`Vrátit prompt „${label}" na default? Tvoje úpravy se ztratí.`)) return;
    setBusy(module);
    try {
      const res = await fetch(`/api/settings/ai-prompts/${module}`, { method: "DELETE" });
      if (res.ok) {
        setSuccess(`Reset: ${module} vráceno na default.`);
        setTimeout(() => setSuccess(null), 4000);
        void load();
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="text-center py-12"><Loader2 className="size-8 animate-spin mx-auto text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl">AI prompty</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Edituj instrukce pro AI v jednotlivých modulech. Změna se projeví okamžitě (60s cache).
          Reset = vrátí na původní default v kódu.
        </p>
      </div>

      {success && (
        <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2">
          <Check className="size-4" /> {success}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="size-4" /></button>
        </div>
      )}

      <div className="space-y-3">
        {prompts.map((p) => (
          <div
            key={p.module}
            className="glass rounded-xl p-4 space-y-2"
            style={{ ["--c" as string]: `var(--tint-${p.tint})` }}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-serif text-lg">{p.label}</h2>
                  {p.isCustom && (
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[var(--tint-butter)]/20 text-[var(--tint-butter)]">
                      vlastní
                    </span>
                  )}
                  <span className="text-xs font-mono text-muted-foreground">{p.module}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                {p.isCustom && p.updatedAt && (
                  <p className="text-xs font-mono text-muted-foreground mt-1">
                    Naposledy upraveno: {new Date(p.updatedAt).toLocaleString("cs-CZ")}
                  </p>
                )}
              </div>
              {editingModule !== p.module && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(p)}
                    className="p-2 rounded hover:bg-white/5 text-muted-foreground"
                    title="Upravit"
                  >
                    <Edit3 className="size-4" />
                  </button>
                  {p.isCustom && (
                    <button
                      onClick={() => reset(p.module, p.label)}
                      disabled={busy === p.module}
                      className="p-2 rounded hover:bg-white/5 text-muted-foreground"
                      title="Reset na default"
                    >
                      {busy === p.module ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                    </button>
                  )}
                </div>
              )}
            </div>

            {editingModule === p.module ? (
              <div className="space-y-2 pt-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={20}
                  className="w-full font-mono text-xs rounded-md border border-white/10 bg-black/30 p-3 leading-relaxed"
                />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{editContent.length} znaků</span>
                  <button
                    onClick={() => setShowDefault(showDefault === p.module ? null : p.module)}
                    className="ml-auto text-xs underline"
                  >
                    {showDefault === p.module ? "Skrýt" : "Zobrazit"} default
                  </button>
                </div>
                {showDefault === p.module && (
                  <details open className="rounded-md bg-black/15 p-3">
                    <summary className="text-xs text-muted-foreground cursor-pointer mb-2">DEFAULT (z kódu)</summary>
                    <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-muted-foreground">{p.default}</pre>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditContent(p.default)}
                      className="mt-2"
                    >
                      Nahradit edit defaultem
                    </Button>
                  </details>
                )}
                <div className="flex gap-2">
                  <Button onClick={() => save(p.module)} disabled={busy === p.module || !editContent.trim()}>
                    {busy === p.module ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Save /> Uložit</>}
                  </Button>
                  <Button variant="ghost" onClick={cancelEdit}><X /> Zrušit</Button>
                </div>
              </div>
            ) : (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground flex items-center gap-1">
                  <Eye className="size-3" /> Zobrazit aktuální prompt ({p.current.length} znaků)
                </summary>
                <pre className="mt-2 font-mono whitespace-pre-wrap leading-relaxed bg-black/15 p-3 rounded text-muted-foreground">{p.current}</pre>
              </details>
            )}
          </div>
        ))}
      </div>

      <div className="glass rounded-xl p-4 text-xs text-muted-foreground">
        <strong>Jak to funguje:</strong> default prompt je v kódu (single source of truth).
        Pokud upravíš a uložíš, vznikne override v DB. AI volání pak používá override.
        Reset smaže override → AI se vrátí k defaultu.
        Cache 60 s — takže nová změna se může v aktivním AI volání projevit až za chvilku.
      </div>
    </div>
  );
}
