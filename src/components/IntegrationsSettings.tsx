import { useEffect, useState } from "react";
import { Check, Loader2, Plug, Trash2, TriangleAlert, Key, Folder, Star } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface InitialProps {
  hasToken: boolean;
  vyruseniProjectId: string | null;
  vipProjectId: string | null;
  mojeUkolyProjectId: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
}

interface Project {
  id: string;
  name: string;
  is_inbox_project?: boolean;
}

export default function IntegrationsSettings({ initial }: { initial: InitialProps }) {
  const [hasToken, setHasToken] = useState(initial.hasToken);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [vyruseni, setVyruseni] = useState(initial.vyruseniProjectId ?? "");
  const [vip, setVip] = useState(initial.vipProjectId ?? "");
  const [mojeUkoly, setMojeUkoly] = useState(initial.mojeUkolyProjectId ?? "");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const lastUsed = initial.lastUsedAt ? new Date(initial.lastUsedAt) : null;
  const lastErr = initial.lastError;

  async function loadProjects(force = false) {
    // force = po saveToken, kdy je hasToken state ještě ve staré hodnotě
    if (!force && !hasToken) return;
    setLoadingProjects(true);
    try {
      const res = await fetch("/api/integrations/todoist/projects");
      const data = await res.json();
      if (res.ok) setProjects(data.projects ?? []);
    } finally {
      setLoadingProjects(false);
    }
  }

  useEffect(() => { loadProjects(); /* eslint-disable-next-line */ }, []);

  async function saveToken() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/todoist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Uložení selhalo.");
        return;
      }
      setHasToken(true);
      setToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      loadProjects(true);
    } catch {
      setError("Síťová chyba.");
    } finally {
      setSaving(false);
    }
  }

  async function saveConfig() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/todoist/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vyruseni: vyruseni || null,
          vip: vip || null,
          mojeUkoly: mojeUkoly || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Uložení selhalo.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Síťová chyba.");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/todoist/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Test selhal.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setTesting(false);
    }
  }

  async function removeToken() {
    if (!confirm("Opravdu smazat Todoist token?")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/todoist", { method: "DELETE" });
      if (res.ok) {
        setHasToken(false);
        setProjects([]);
        setVyruseni("");
        setVip("");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-xl">Integrace</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Propojení s externími službami. Zatím jen Todoist (pro Gideonův Firewall).
        </p>
      </div>

      {/* Todoist token */}
      <div className="glass rounded-xl p-5 space-y-4" style={{ ["--c" as string]: "var(--tint-mint)" }}>
        <div className="flex items-center gap-2">
          <Plug className="size-4" style={{ color: "var(--c)" }} />
          <h3 className="font-serif text-lg">Todoist API token</h3>
          {hasToken && <span className="ml-auto text-xs font-mono text-[var(--tint-sage)]">✓ uložen</span>}
        </div>

        {!hasToken ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Získat token: <a href="https://todoist.com/app/settings/integrations/developer" target="_blank" rel="noreferrer" className="underline">todoist.com/app/settings/integrations/developer</a>
            </p>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
                API token
              </label>
              <div className="relative">
                <Key className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="0123456789abcdef..."
                  className="pl-9 font-mono"
                  disabled={saving}
                />
              </div>
            </div>
            <Button onClick={saveToken} disabled={saving || token.trim().length < 10}>
              {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Check /> Uložit token</>}
            </Button>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="text-muted-foreground text-xs">
              Token je uložený zašifrovaně. Pokud chceš změnit, nejdřív smaž a znovu ulož.
            </div>
            {lastUsed && (
              <div className="text-xs font-mono text-muted-foreground">
                Naposledy použit: {lastUsed.toLocaleString("cs-CZ")}
              </div>
            )}
            {lastErr && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 text-xs px-3 py-2 flex items-start gap-2">
                <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
                <span className="font-mono">{lastErr}</span>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={testConnection} disabled={testing}>
                {testing ? <><Loader2 className="animate-spin" /> Testuju…</> : "Test připojení"}
              </Button>
              <Button variant="ghost" onClick={removeToken} disabled={saving}>
                <Trash2 /> Smazat
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Projekty */}
      {hasToken && (
        <div className="glass rounded-xl p-5 space-y-4" style={{ ["--c" as string]: "var(--tint-peach)" }}>
          <div className="flex items-center gap-2">
            <Folder className="size-4" style={{ color: "var(--c)" }} />
            <h3 className="font-serif text-lg">Projekty pro Firewall</h3>
          </div>

          {loadingProjects ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Načítám projekty…
            </div>
          ) : projects.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Žádné projekty. Nejdřív vytvoř v Todoist projekty „Vyrušení" a „VIP", pak klikni na Test připojení.
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
                  Vyrušení (běžná volání)
                </label>
                <select
                  value={vyruseni}
                  onChange={(e) => setVyruseni(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 focus:border-primary focus:outline-none text-sm"
                >
                  <option value="">— Inbox (default) —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono flex items-center gap-1">
                  <Star className="size-3" /> VIP kontakty (priorita 4 + due today)
                </label>
                <select
                  value={vip}
                  onChange={(e) => setVip(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 focus:border-primary focus:outline-none text-sm"
                >
                  <option value="">— Inbox (default) —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-white/5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
                  Moje úkoly (Capture → Todoist)
                </label>
                <select
                  value={mojeUkoly}
                  onChange={(e) => setMojeUkoly(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 focus:border-primary focus:outline-none text-sm"
                >
                  <option value="">— Inbox (default) —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Kam chodí tvoje vlastní úkoly z diktátu přes tlačítko „Do Todoistu" na stránce /tasks.
                </p>
              </div>

              <Button onClick={saveConfig} disabled={saving}>
                {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Check /> Uložit projekty</>}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Bulk import projektů + labelů */}
      {hasToken && <TodoistBulkImport onDone={loadProjects} />}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">
          {error}
        </div>
      )}
      {saved && (
        <div className="text-xs text-[var(--tint-sage)] font-mono">Uloženo ✓</div>
      )}
    </div>
  );
}

// =============================================================================
// Bulk import — vytvoří projekty a labely v Todoistu z textového inputu
// =============================================================================

function TodoistBulkImport({ onDone }: { onDone: () => void }) {
  const [show, setShow] = useState(false);
  const [projectsText, setProjectsText] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const [busy, setBusy] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [results, setResults] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function parseProjects(text: string): { name: string; parentName: string | null }[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(">").map((s) => s.trim()).filter(Boolean);
        if (parts.length >= 2) {
          return { name: parts[parts.length - 1], parentName: parts[parts.length - 2] };
        }
        return { name: parts[0] ?? line, parentName: null };
      });
  }

  function parseLabels(text: string): { name: string }[] {
    return text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    setResults(null);
    try {
      const projects = parseProjects(projectsText);
      const labels = parseLabels(labelsText);
      if (projects.length === 0 && labels.length === 0) {
        setErr("Nic k importu — vyplň aspoň jeden projekt nebo label.");
        return;
      }
      const res = await fetch("/api/todoist/bulk-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projects, labels }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Bulk setup selhal.");
        return;
      }
      setResults(data);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass rounded-xl p-4 space-y-3">
      <button
        onClick={() => setShow(!show)}
        className="flex items-center justify-between w-full"
      >
        <h3 className="font-serif text-lg">Bulk import (projekty + labely)</h3>
        <span className="text-xs font-mono text-muted-foreground">{show ? "skrýt" : "rozbalit"}</span>
      </button>
      {show && (
        <>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Vytvoří projekty a labely v Todoistu jedním klikem. Idempotentní —
            existující se přeskočí (case-insensitive match na name). Hodí se pro
            první setup.
          </p>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              Projekty (jeden na řádek; <code>Parent {">"} Child</code> pro hierarchii)
            </label>
            <textarea
              value={projectsText}
              onChange={(e) => setProjectsText(e.target.value)}
              rows={6}
              placeholder={"Vyrušení\nVIP\nMoje úkoly\nART76 > Knížka"}
              className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-xs font-mono resize-y"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              Labely (jeden na řádek nebo oddělené čárkou)
            </label>
            <textarea
              value={labelsText}
              onChange={(e) => setLabelsText(e.target.value)}
              rows={4}
              placeholder="capture, urgent, klient-A, dum, auto"
              className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-xs font-mono resize-y"
            />
          </div>

          <Button onClick={submit} disabled={busy}>
            {busy ? <><Loader2 className="animate-spin" /> Importuji…</> : "Spustit bulk import"}
          </Button>

          {err && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 text-xs px-3 py-2">
              {err}
            </div>
          )}

          {results && (
            <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Výsledky</div>
              <div>
                <strong>Projekty:</strong> {results.summary.projectsCreated} nových, {" "}
                {results.summary.projectsExisting} už existovalo, {" "}
                {results.summary.projectsFailed} chyb
              </div>
              <div>
                <strong>Labely:</strong> {results.summary.labelsCreated} nových, {" "}
                {results.summary.labelsExisting} už existovalo, {" "}
                {results.summary.labelsFailed} chyb
              </div>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {results.projects.filter((r: any) => r.error).length > 0 && (
                <details className="text-[var(--tint-rose)]">
                  <summary className="cursor-pointer">Chyby projektů</summary>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {results.projects.filter((r: any) => r.error).map((r: any) => (
                      <li key={r.name}><strong>{r.name}</strong>: {r.error}</li>
                    ))}
                  </ul>
                </details>
              )}
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {results.labels.filter((r: any) => r.error).length > 0 && (
                <details className="text-[var(--tint-rose)]">
                  <summary className="cursor-pointer">Chyby labelů</summary>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {results.labels.filter((r: any) => r.error).map((r: any) => (
                      <li key={r.name}><strong>{r.name}</strong>: {r.error}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
