import { useEffect, useState } from "react";
import { Check, Loader2, Video, X } from "lucide-react";
import { Button } from "./ui/Button";

/**
 * Meet místnost projektu (Gideon 2026-08-05: „chci každý mít pro jednotlivé
 * studánky samostatný link — a to samé do Prskavky").
 *
 * Karta v detailu projektu (studánka i prskavka — sdílený StudnaDetail):
 * vytvoření nové místnosti jedním klikem (spaces.create + auto-recording),
 * nebo navázání existujícího linku. Schůzky z navázané místnosti se po
 * přepisu AUTO-přiřazují do tohoto projektu.
 */

interface SpaceRow {
  id: string;
  meetingCode: string;
  label: string | null;
  autoRecordOk: boolean;
  lastError: string | null;
}

export default function ProjectMeetRoom({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteVal, setPasteVal] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/studna/meet/spaces?projectId=${encodeURIComponent(projectId)}`).catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      setSpaces(d.spaces ?? []);
    } else {
      setSpaces([]);
    }
  }
  useEffect(() => { void load(); }, [projectId]);

  async function createRoom() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/studna/meet/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ createNew: true, projectId, label: projectName }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Vytvoření selhalo."); return; }
      await load();
    } catch { setError("Síťová chyba."); }
    finally { setBusy(false); }
  }

  async function bindExisting() {
    if (!pasteVal.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/studna/meet/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: pasteVal, projectId, label: projectName }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Navázání selhalo."); return; }
      setPasteVal("");
      setPasteOpen(false);
      await load();
    } catch { setError("Síťová chyba."); }
    finally { setBusy(false); }
  }

  async function unbind(id: string) {
    if (!confirm("Odebrat místnost z projektu? Místnost u Googlu žije dál, jen se přestanou auto-přiřazovat přepisy.")) return;
    const res = await fetch(`/api/studna/meet/spaces?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) await load();
  }

  function copyLink(code: string) {
    void navigator.clipboard.writeText(`https://meet.google.com/${code}`);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  if (spaces === null) return null;

  return (
    <div className="glass-subtle rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Video className="size-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium">Meet místnost projektu</span>
        {spaces.length === 0 ? (
          <>
            <span className="text-xs text-muted-foreground">— schůzky z ní se sem přepíšou samy</span>
            <span className="ml-auto flex items-center gap-2">
              <Button onClick={createRoom} disabled={busy} size="sm">
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Vytvořit místnost
              </Button>
              <button
                type="button"
                onClick={() => setPasteOpen((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >mám už link</button>
            </span>
          </>
        ) : (
          <span className="ml-auto flex items-center gap-2 flex-wrap">
            {spaces.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 text-sm">
                <a
                  href={`https://meet.google.com/${s.meetingCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs underline underline-offset-2 hover:text-foreground"
                >meet.google.com/{s.meetingCode}</a>
                <button
                  type="button"
                  onClick={() => copyLink(s.meetingCode)}
                  className="text-[11px] font-mono text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5"
                >{copied === s.meetingCode ? <><Check className="size-3 inline -mt-0.5 mr-1" />zkopírováno</> : "kopírovat"}</button>
                {s.autoRecordOk ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--tint-sage)]"><Check className="size-3" /> nahrává se</span>
                ) : s.lastError ? (
                  <span className="text-[11px] font-mono text-[color:var(--c-signal)]" title={s.lastError}>chyba nahrávání</span>
                ) : (
                  <span className="text-[11px] font-mono text-muted-foreground">čeká na kontrolu…</span>
                )}
                <button type="button" onClick={() => void unbind(s.id)} title="Odebrat místnost" className="p-0.5 rounded text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </span>
        )}
      </div>
      {pasteOpen && spaces.length === 0 && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <input
            value={pasteVal}
            onChange={(e) => setPasteVal(e.target.value)}
            placeholder="meet.google.com/xxx-xxxx-xxx"
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm font-mono w-64"
          />
          <Button onClick={bindExisting} disabled={busy || !pasteVal.trim()} size="sm" variant="outline">Navázat</Button>
        </div>
      )}
      {error && <div className="mt-2 text-sm text-[var(--destructive,#e5484d)]">{error}</div>}
    </div>
  );
}
