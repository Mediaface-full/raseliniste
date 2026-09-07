import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Loader2, RefreshCw, RotateCw, Video, X, Check } from "lucide-react";
import { Button } from "./ui/Button";

/**
 * Inbox přepisů Google Meet schůzek (Gideon 2026-08-04) — sekce na /studna.
 * Cron je plní automaticky; tady se zápis přečte a přiřadí k projektu
 * (vznikne ProjectRecording s analýzou + RAG). Nechtěné se zahodí (tombstone).
 */

interface MeetNoteRow {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  processingError: string | null;
  eventTitle: string | null;
  summaryMd: string | null;
  transcriptChars: number;
  project: { id: string; name: string } | null;
  recordingId: string | null;
}

interface ProjectOpt { id: string; name: string }

interface SpaceRow {
  id: string;
  meetingCode: string;
  label: string | null;
  autoRecordOk: boolean;
  lastError: string | null;
}

export default function MeetInbox() {
  const [notes, setNotes] = useState<MeetNoteRow[] | null>(null);
  const [hasScope, setHasScope] = useState(true);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Gideon 2026-08-10: default jen poslední 3, zbytek na rozkliknutí
  const [showAll, setShowAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Registrované místnosti s auto-nahráváním (spaces.patch self-heal v cronu)
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [newSpace, setNewSpace] = useState("");
  const [newSpaceLabel, setNewSpaceLabel] = useState("");
  const [addingSpace, setAddingSpace] = useState(false);

  async function load() {
    // FIX 2026-08-04 (Gideon: „proste to nevidim"): když load selže, sekce
    // se dřív VŮBEC nevykreslila (notes zůstalo null → return null).
    // Teď se vždy ukáže — i s chybou, ať je co poslat.
    try {
      const [meetRes, projRes, spacesRes] = await Promise.all([
        fetch("/api/studna/meet"),
        fetch("/api/studna"),
        fetch("/api/studna/meet/spaces"),
      ]);
      if (spacesRes.ok) {
        const d = await spacesRes.json();
        setSpaces(d.spaces ?? []);
      }
      if (meetRes.ok) {
        const d = await meetRes.json();
        setNotes(d.notes ?? []);
        setHasScope(d.hasMeetScope ?? false);
      } else {
        const d = await meetRes.json().catch(() => null);
        setNotes([]);
        setError(`Načtení Meet sekce selhalo (HTTP ${meetRes.status}${d?.error ? `: ${d.error}` : ""}) — pošli tohle Claudovi.`);
      }
      if (projRes.ok) {
        const d = await projRes.json();
        setProjects((d.projects ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
      }
    } catch (e) {
      setNotes([]);
      setError(`Načtení Meet sekce selhalo (${e instanceof Error ? e.message : "síťová chyba"}).`);
    }
  }
  useEffect(() => { void load(); }, []);

  async function syncNow() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/studna/meet", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Sync selhal."); return; }
      setMessage(`Nalezeno ${d.stats?.conferences ?? 0} schůzek · ${d.stats?.processed ?? 0} se zpracovává · ${d.stats?.stillPending ?? 0} čeká na nahrávku`);
      setTimeout(() => setMessage(null), 8000);
      await load();
    } catch { setError("Síťová chyba."); }
    finally { setSyncing(false); }
  }

  async function assign(noteId: string, projectId: string) {
    if (!projectId) return;
    setError(null);
    const res = await fetch(`/api/studna/meet/${noteId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
    }).catch(() => null);
    const d = await res?.json().catch(() => null);
    if (!res?.ok) { setError(d?.error ?? "Přiřazení selhalo."); return; }
    await load();
  }

  async function addSpace() {
    if (!newSpace.trim()) return;
    setAddingSpace(true);
    setError(null);
    try {
      const res = await fetch("/api/studna/meet/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: newSpace, label: newSpaceLabel.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Přidání selhalo."); return; }
      setNewSpace("");
      setNewSpaceLabel("");
      setSpaces((s) => {
        const next = s.filter((x) => x.id !== d.space.id);
        return [...next, d.space];
      });
    } finally { setAddingSpace(false); }
  }

  async function removeSpace(id: string) {
    const res = await fetch(`/api/studna/meet/spaces?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) setSpaces((s) => s.filter((x) => x.id !== id));
    else setError("Odebrání místnosti selhalo.");
  }

  // Gideon 2026-09-01: mizerný přepis → přepsat znovu (nový model Pro)
  async function retranscribe(noteId: string) {
    setError(null);
    const res = await fetch(`/api/studna/meet/${noteId}`, { method: "PATCH" }).catch(() => null);
    const d = await res?.json().catch(() => null);
    if (!res?.ok) { setError(d?.error ?? "Přepsání selhalo."); return; }
    setMessage("Přepisuje se znovu — hotový zápis se tu za pár minut obnoví sám.");
    setTimeout(() => setMessage(null), 8000);
    await load();
  }

  // Gideon 2026-09-01: kopírování zápisu/přepisu do schránky
  const [copied, setCopied] = useState<string | null>(null);
  async function copyNote(noteId: string, what: "summary" | "transcript") {
    setError(null);
    const res = await fetch(`/api/studna/meet/${noteId}`).catch(() => null);
    const d = await res?.json().catch(() => null);
    if (!res?.ok || !d?.note) { setError(d?.error ?? "Načtení zápisu selhalo."); return; }
    const text = what === "summary" ? (d.note.summaryMd ?? "") : (d.note.transcript ?? "");
    if (!text.trim()) { setError(what === "summary" ? "Zápis je prázdný." : "Přepis je prázdný."); return; }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`${noteId}-${what}`);
      setTimeout(() => setCopied(null), 2500);
    } catch { setError("Kopírování selhalo — zkopíruj text ručně z rozbaleného detailu."); }
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
    const res = await fetch(`/api/studna/meet/${noteId}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) setNotes((ns) => ns?.filter((n) => n.id !== noteId) ?? null);
  }

  const fmtWhen = (n: MeetNoteRow) => {
    const s = new Date(n.startedAt);
    const dur = n.endedAt ? Math.round((new Date(n.endedAt).getTime() - s.getTime()) / 60000) : null;
    return `${s.toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" })} ${s.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}${dur ? ` · ${dur} min` : ""}`;
  };

  if (notes === null) {
    return (
      <div className="glass-subtle rounded-xl p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Video className="size-4" />
        <span className="font-medium text-foreground">Zápisy ze schůzek (Meet)</span>
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="glass-subtle rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Video className="size-4 text-muted-foreground" />
        <span className="font-medium">Zápisy ze schůzek (Meet)</span>
        <span className="text-xs text-muted-foreground">— nahrané schůzky se přepisují samy à 30 min</span>
        <Button onClick={syncNow} disabled={syncing} variant="ghost" size="sm" className="ml-auto">
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Zkontrolovat teď
        </Button>
      </div>

      {!hasScope && (
        <div className="text-sm rounded-md border border-[color:var(--c-signal)]/40 bg-[color:var(--c-signal)]/5 px-3 py-2">
          Google napojení nemá oprávnění pro Meet. <a href="/settings/integrations/google" className="underline font-medium">Rozšířit oprávnění →</a>
          <span className="block text-xs text-muted-foreground mt-1">Po reauthorizaci navíc v GCP Console zapni Google Meet API a Google Drive API (jednorázově).</span>
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

      {/* Registrované místnosti — auto-recording self-heal (recept z návodu) */}
      <div>
        <button
          type="button"
          onClick={() => setSpacesOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {spacesOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          Místnosti s automatickým nahráváním ({spaces.length})
        </button>
        {spacesOpen && (
          <div className="mt-2 space-y-2">
            <div className="text-xs text-muted-foreground">
              Trvalé Meet linky (např. místnost pro klienta). Systém jim každých 30 minut
              zapíná automatické nahrávání — schůzka se pak nahraje i bez kliknutí na Record.
            </div>
            {spaces.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm rounded-md border border-border px-3 py-1.5 flex-wrap">
                {/* Gideon 2026-08-05: „kde najdu link na ten meet?" — kód je
                    klikací odkaz do schůzky + tlačítko na zkopírování linku */}
                <a
                  href={`https://meet.google.com/${s.meetingCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs underline underline-offset-2 hover:text-foreground"
                  title="Otevřít schůzku"
                >meet.google.com/{s.meetingCode}</a>
                <button
                  type="button"
                  onClick={(e) => {
                    void navigator.clipboard.writeText(`https://meet.google.com/${s.meetingCode}`);
                    const b = e.currentTarget;
                    b.textContent = "✓ zkopírováno";
                    setTimeout(() => { b.textContent = "kopírovat link"; }, 2000);
                  }}
                  className="text-[11px] font-mono text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5"
                >kopírovat link</button>
                {s.label && <span className="text-muted-foreground text-xs truncate">{s.label}</span>}
                {s.autoRecordOk ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--tint-sage)] ml-auto"><Check className="size-3" /> nahrávání zapnuto</span>
                ) : s.lastError ? (
                  <span className="text-[11px] font-mono text-[color:var(--c-signal)] ml-auto truncate max-w-[16rem]" title={s.lastError}>selhalo: {s.lastError.slice(0, 60)}…</span>
                ) : (
                  <span className="text-[11px] font-mono text-muted-foreground ml-auto">čeká na první heal…</span>
                )}
                <button type="button" onClick={() => void removeSpace(s.id)} title="Odebrat místnost" className="p-1 rounded text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={newSpace}
                onChange={(e) => setNewSpace(e.target.value)}
                placeholder="meet.google.com/xxx-xxxx-xxx"
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm font-mono w-64"
              />
              <input
                value={newSpaceLabel}
                onChange={(e) => setNewSpaceLabel(e.target.value)}
                placeholder="popisek (volitelný)"
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm w-44"
              />
              <Button onClick={() => void addSpace()} disabled={addingSpace || !newSpace.trim()} size="sm" variant="outline">
                {addingSpace ? <Loader2 className="size-4 animate-spin" /> : null}
                Přidat místnost
              </Button>
            </div>
          </div>
        )}
      </div>

      {notes.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">Žádné zápisy — až proběhne nahraná Meet schůzka, objeví se tady.</div>
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
                    <span className="truncate font-medium">{n.eventTitle ?? "Schůzka bez názvu"}</span>
                  </button>
                  {n.status === "pending" && <span className="text-[11px] font-mono text-muted-foreground">čeká na nahrávku…</span>}
                  {n.status === "processing" && <span className="text-[11px] font-mono text-[var(--tint-sky)]">přepisuje se…</span>}
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
                  {((n.status === "done" && !n.recordingId) || n.status === "error") && (
                    <button type="button" onClick={() => void retranscribe(n.id)} title="Přepsat znovu (kvalitnější model) — když je přepis špatný" className="p-1 rounded text-muted-foreground hover:text-foreground">
                      <RotateCw className="size-3.5" />
                    </button>
                  )}
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
                    ) : (
                      <div className="text-xs text-muted-foreground italic">Zápis zatím není.</div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {n.summaryMd && (
                        <button type="button" onClick={() => void copyNote(n.id, "summary")}
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-accent">
                          {copied === `${n.id}-summary` ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                          {copied === `${n.id}-summary` ? "Zkopírováno" : "Kopírovat zápis"}
                        </button>
                      )}
                      {n.transcriptChars > 0 && (
                        <button type="button" onClick={() => void copyNote(n.id, "transcript")}
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-accent">
                          {copied === `${n.id}-transcript` ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                          {copied === `${n.id}-transcript` ? "Zkopírováno" : "Kopírovat přepis"}
                        </button>
                      )}
                      {n.transcriptChars > 0 && (
                        <span className="text-[11px] font-mono text-muted-foreground">plný přepis: {Math.round(n.transcriptChars / 1000)} tis. znaků</span>
                      )}
                    </div>
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
