import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Mic, RefreshCw, X, Check } from "lucide-react";
import { Button } from "./ui/Button";

/**
 * Inbox přepisů z Plaud diktafonu (Gideon 2026-08-09) — sekce na /studna,
 * stejný vzor jako MeetInbox. Cron plaud-sync (à 30 min) stahuje přepis
 * i souhrn přímo z Plaud cloudu; tady se zápis přečte a přiřadí k projektu
 * (vznikne ProjectRecording s analýzou + RAG). Nechtěné se zahodí (tombstone).
 */

interface PlaudNoteRow {
  id: string;
  title: string | null;
  recordedAt: string;
  durationSec: number | null;
  status: string;
  processingError: string | null;
  summaryMd: string | null;
  transcriptChars: number;
  project: { id: string; name: string } | null;
  recordingId: string | null;
}

interface ProjectOpt { id: string; name: string }

export default function PlaudInbox() {
  const [notes, setNotes] = useState<PlaudNoteRow[] | null>(null);
  const [connected, setConnected] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Gideon 2026-08-10: default jen poslední 3, zbytek na rozkliknutí (jako Meet)
  const [showAll, setShowAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const [plaudRes, projRes] = await Promise.all([
        fetch("/api/studna/plaud"),
        fetch("/api/studna"),
      ]);
      if (plaudRes.ok) {
        const d = await plaudRes.json();
        setNotes(d.notes ?? []);
        setConnected(d.connected ?? false);
        setLastError(d.lastError ?? null);
      } else {
        const d = await plaudRes.json().catch(() => null);
        setNotes([]);
        setError(`Načtení Plaud sekce selhalo (HTTP ${plaudRes.status}${d?.error ? `: ${d.error}` : ""}) — pošli tohle Claudovi.`);
      }
      if (projRes.ok) {
        const d = await projRes.json();
        setProjects((d.projects ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
      }
    } catch (e) {
      setNotes([]);
      setError(`Načtení Plaud sekce selhalo (${e instanceof Error ? e.message : "síťová chyba"}).`);
    }
  }
  useEffect(() => { void load(); }, []);

  async function syncNow() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/studna/plaud", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Sync selhal."); return; }
      setMessage(`Nalezeno ${d.stats?.listed ?? 0} nahrávek · ${d.stats?.created ?? 0} nových zápisů${d.stats?.transcribing ? ` · ${d.stats.transcribing} se přepisuje` : ""}`);
      setTimeout(() => setMessage(null), 8000);
      await load();
    } catch { setError("Síťová chyba."); }
    finally { setSyncing(false); }
  }

  async function assign(noteId: string, projectId: string) {
    if (!projectId) return;
    setError(null);
    const res = await fetch(`/api/studna/plaud/${noteId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
    }).catch(() => null);
    const d = await res?.json().catch(() => null);
    if (!res?.ok) { setError(d?.error ?? "Přiřazení selhalo."); return; }
    await load();
  }

  // confirm() v PWA nefunguje → dvouklikové potvrzení v UI
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  async function remove(noteId: string) {
    if (confirmRemove !== noteId) {
      setConfirmRemove(noteId);
      setTimeout(() => setConfirmRemove((v) => (v === noteId ? null : v)), 4000);
      return;
    }
    setConfirmRemove(null);
    const res = await fetch(`/api/studna/plaud/${noteId}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) setNotes((ns) => ns?.filter((n) => n.id !== noteId) ?? null);
  }

  const fmtWhen = (n: PlaudNoteRow) => {
    const s = new Date(n.recordedAt);
    const dur = n.durationSec ? ` · ${Math.round(n.durationSec / 60)} min` : "";
    return `${s.toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" })} ${s.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}${dur}`;
  };

  if (notes === null) {
    return (
      <div className="glass-subtle rounded-xl p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Mic className="size-4" />
        <span className="font-medium text-foreground">Přepisy z Plaud</span>
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  // Bez připojení a bez zápisů sekci neukazovat vůbec — jen nenápadný odkaz
  if (!connected && notes.length === 0) {
    return (
      <div className="glass-subtle rounded-xl p-4 flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <Mic className="size-4" />
        <span className="font-medium text-foreground">Přepisy z Plaud</span>
        <span>— diktafon není připojený.</span>
        <a href="/settings/integrations/plaud" className="underline font-medium">Připojit →</a>
      </div>
    );
  }

  return (
    <div className="glass-subtle rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Mic className="size-4 text-muted-foreground" />
        <span className="font-medium">Přepisy z Plaud</span>
        <span className="text-xs text-muted-foreground">— nahrávky z diktafonu se stahují samy à 30 min</span>
        <Button onClick={syncNow} disabled={syncing} variant="ghost" size="sm" className="ml-auto">
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Zkontrolovat teď
        </Button>
      </div>

      {lastError && (
        <div className="text-sm rounded-md border border-[color:var(--c-signal)]/40 bg-[color:var(--c-signal)]/5 px-3 py-2">
          {lastError} <a href="/settings/integrations/plaud" className="underline font-medium">Nastavení Plaud →</a>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-destructive" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-muted-foreground hover:text-foreground" aria-label="Zavřít chybu"><X className="size-4" /></button>
        </div>
      )}
      {message && (
        <div role="status" className="rounded-md border border-[var(--tint-mint)]/40 bg-[var(--tint-mint)]/10 text-sm px-3 py-2 flex items-start gap-2">
          <Check className="size-4 shrink-0 mt-0.5 text-[var(--tint-mint)]" />
          <span className="flex-1">{message}</span>
          <button type="button" onClick={() => setMessage(null)} className="text-muted-foreground hover:text-foreground" aria-label="Zavřít zprávu"><X className="size-4" /></button>
        </div>
      )}

      {notes.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">Žádné zápisy — až Plaud zpracuje nahrávku, objeví se tady.</div>
      ) : (
        <div className="space-y-2">
          {(showAll ? notes : notes.slice(0, 3)).map((n) => {
            const isOpen = open.has(n.id);
            return (
              <div key={n.id} className="rounded-lg border border-border bg-card/50">
                <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; })}
                    className="flex items-center gap-2 text-sm text-left flex-1 min-w-0"
                  >
                    {isOpen ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                    <span className="font-mono text-xs text-muted-foreground tabular shrink-0">{fmtWhen(n)}</span>
                    <span className="truncate font-medium">{n.title ?? "Nahrávka bez názvu"}</span>
                  </button>
                  {n.status === "processing" && <span className="text-[11px] font-mono text-[var(--tint-sky)]" title="Audio se stahuje z Plaud cloudu a přepisuje u nás — dlouhé nahrávky můžou trvat i desítky minut.">přepisuje se…</span>}
                  {n.status === "error" && <span className="text-[11px] font-mono text-[color:var(--c-signal)]" title={n.processingError ?? ""}>chyba</span>}
                  {n.recordingId && n.project ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--tint-sage)]">
                      <Check className="size-3" /> {n.project.name}
                    </span>
                  ) : n.status === "done" ? (
                    <select
                      defaultValue=""
                      onChange={(e) => void assign(n.id, e.target.value)}
                      className="rounded-md border border-border bg-card px-2 py-1 text-xs"
                    >
                      <option value="">→ přiřadit k projektu…</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : null}
                  <button type="button" onClick={() => void remove(n.id)} title={confirmRemove === n.id ? "Opravdu zahodit? Klikni znovu" : "Zahodit zápis"} className={`p-1 rounded ${confirmRemove === n.id ? "text-[color:var(--c-signal)]" : "text-muted-foreground hover:text-foreground"}`}>
                    {confirmRemove === n.id ? <span className="text-[11px] font-mono px-1">Opravdu?</span> : <X className="size-3.5" />}
                  </button>
                </div>
                {isOpen && (
                  <div className="px-4 pb-3 space-y-2">
                    {n.status === "error" && n.processingError && (
                      <div className="text-xs text-[color:var(--c-signal)]">{n.processingError}</div>
                    )}
                    {n.summaryMd ? (
                      <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed rounded-md bg-black/10 p-3 max-h-96 overflow-y-auto">{n.summaryMd}</pre>
                    ) : n.status === "processing" ? (
                      <div className="text-xs text-muted-foreground">
                        Audio se přepisuje u nás (Gemini) — u dlouhých nahrávek to může trvat
                        i desítky minut. Hotový zápis se tu objeví sám.
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic">Souhrn zatím není.</div>
                    )}
                    {n.transcriptChars > 0 && (
                      <div className="text-[11px] font-mono text-muted-foreground">plný přepis: {Math.round(n.transcriptChars / 1000)} tis. znaků (uloží se do projektu při přiřazení)</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {notes.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {showAll ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {showAll ? "Zobrazit jen poslední 3" : `Zobrazit starší (${notes.length - 3})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
