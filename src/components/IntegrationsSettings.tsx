import { useEffect, useState } from "react";
import { Check, Loader2, Plug, Trash2, TriangleAlert, Key, Folder, Star } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

/**
 * Pravidlo pro routing #5 — multi-tag (matchne když task.tags obsahuje kterýkoli z `tags`).
 * `name` je volitelný popisek pro orientaci v dlouhém seznamu — nepoužívá se v logice.
 */
interface TagRuleInitial {
  name: string | null;
  tags: string[];
  project: string;
  section: string | null;
}

interface InitialProps {
  hasToken: boolean;
  vyruseniProjectId: string | null;
  vipProjectId: string | null;
  mojeUkolyProjectId: string | null;
  praceProjectName: string | null;
  peopleProjectName: string | null;
  // Nový tvar: pole pravidel. Astro stránka při čtení DB normalizuje starý dict.
  tagRules: TagRuleInitial[];
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
  // Smart routing config — názvy projektů (Petr přepíše defaultní pokud chce jiný název)
  const [praceProjectName, setPraceProjectName] = useState(initial.praceProjectName ?? "Práce");
  const [peopleProjectName, setPeopleProjectName] = useState(initial.peopleProjectName ?? "Lidé");
  // Multi-tag pravidla. Tags v UI editujeme jako comma-separated string (tagsInput),
  // ale chip preview pod inputem ukazuje co se uloží (split + trim + lowercase).
  const initialTagRows = initial.tagRules.map((r) => ({
    name: r.name ?? "",
    tagsInput: r.tags.join(", "),
    project: r.project,
    section: r.section ?? "",
  }));
  const [tagRows, setTagRows] = useState<
    { name: string; tagsInput: string; project: string; section: string }[]
  >(initialTagRows);
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
      // Sestav array pravidel — vynech pravidla bez tagů nebo bez projektu.
      // Tagy: comma split → trim → lowercase → dedup; prázdné odfiltrovat.
      const tagToProject: Array<{
        name?: string | null;
        tags: string[];
        project: string;
        section: string | null;
      }> = [];
      for (const r of tagRows) {
        const project = r.project.trim();
        if (!project) continue;
        const tags = Array.from(
          new Set(
            r.tagsInput
              .split(",")
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean),
          ),
        );
        if (tags.length === 0) continue;
        tagToProject.push({
          name: r.name.trim() || null,
          tags,
          project,
          section: r.section.trim() || null,
        });
      }
      const res = await fetch("/api/integrations/todoist/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vyruseni: vyruseni || null,
          vip: vip || null,
          mojeUkoly: mojeUkoly || null,
          praceProjectName: praceProjectName.trim() || null,
          peopleProjectName: peopleProjectName.trim() || null,
          tagToProject,
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

  function addTagRow() {
    setTagRows((prev) => [...prev, { name: "", tagsInput: "", project: "", section: "" }]);
  }
  function updateTagRow(
    idx: number,
    patch: Partial<{ name: string; tagsInput: string; project: string; section: string }>,
  ) {
    setTagRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function removeTagRow(idx: number) {
    setTagRows((prev) => prev.filter((_, i) => i !== idx));
  }

  /** Parse comma-separated tagy → array (pro chip preview pod inputem). */
  function parseTagsPreview(input: string): string[] {
    return Array.from(
      new Set(
        input
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      ),
    );
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

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Petr 2026-06-10: auto-link Todoist collaborators s Contacts podle e-mailu.
  // Aby task push posílal responsible_uid (notifikace pro člena týmu).
  const [linkingCollaborators, setLinkingCollaborators] = useState(false);
  const [linkResult, setLinkResult] = useState<string | null>(null);
  async function autoLinkCollaborators() {
    setLinkingCollaborators(true);
    setError(null);
    setLinkResult(null);
    try {
      const res = await fetch("/api/integrations/todoist/auto-link-collaborators", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Auto-link selhal.");
        return;
      }
      const s = data.summary ?? {};
      let msg = `✓ Propojeno ${s.matched ?? 0} kontaktů s Todoist (přeskočeno ${s.skipped ?? 0} už nastavených, ${s.noEmail ?? 0} bez e-mailu).`;
      if (s.unmatchedCollaborators > 0) {
        msg += ` Pozor: ${s.unmatchedCollaborators} Todoist collaborators nemá odpovídající kontakt — přidej je do /contacts.`;
      }
      setLinkResult(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinkingCollaborators(false);
    }
  }
  async function syncProjects(fullReset = false) {
    if (fullReset && !confirm("Plný reset: smaže lokální mirror Todoist projektů + labelů a načte vše čerstvě z Todoistu. Pro vyřešení starých/přejmenovaných projektů co se neprománou. Pokračovat?")) {
      return;
    }
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const res = await fetch("/api/integrations/todoist/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullReset }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Sync selhal.");
        return;
      }
      const s = data.stats ?? {};
      setSyncResult(
        (fullReset ? "✓ FULL RESET — " : "✓ ") +
          `Projekty: ${s.projectsReceived ?? 0} (${s.projectsUpserted ?? 0} updated), ` +
          `labels: ${s.labelsReceived ?? 0}, úkoly: ${s.itemsReceived ?? 0}`,
      );
      setTimeout(() => setSyncResult(null), 10000);
      // Obnov dropdown projektů
      loadProjects(true);
    } catch {
      setError("Síťová chyba.");
    } finally {
      setSyncing(false);
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
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={testConnection} disabled={testing}>
                {testing ? <><Loader2 className="animate-spin" /> Testuju…</> : "Test připojení"}
              </Button>
              <Button variant="outline" onClick={() => syncProjects(false)} disabled={syncing}>
                {syncing ? <><Loader2 className="animate-spin" /> Sync…</> : "Sync projektů + labelů"}
              </Button>
              <Button variant="ghost" onClick={() => syncProjects(true)} disabled={syncing}>
                Full reset mirroru
              </Button>
              <Button
                variant="outline"
                onClick={autoLinkCollaborators}
                disabled={linkingCollaborators}
                title="Spáruje Todoist Workspace členy s kontakty podle emailu. Bez toho task push neposílá responsible_uid (=úkoly nedostávají notifikaci členům)."
              >
                {linkingCollaborators ? <><Loader2 className="animate-spin" /> Propojuji…</> : "Propojit členy týmu"}
              </Button>
              <Button variant="ghost" onClick={removeToken} disabled={saving}>
                <Trash2 /> Smazat
              </Button>
            </div>
            {syncResult && (
              <div className="text-xs text-emerald-400 font-mono pt-1">{syncResult}</div>
            )}
            {linkResult && (
              <div className="text-xs text-emerald-400 font-mono pt-1">{linkResult}</div>
            )}
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

              {/* Smart routing — nový blok 2026-05-10 */}
              <div
                className="rounded-lg p-4 space-y-3 mt-2"
                style={{
                  background: "color-mix(in oklch, var(--tint-mint) 5%, transparent)",
                  border: "1px solid color-mix(in oklch, var(--tint-mint) 25%, transparent)",
                }}
              >
                <div>
                  <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">
                    Smart routing
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Pravidla pro Todoist routing úkolů (top-down):
                    klient-tag → Práce/sekce, klient-kontakt → Práce/sekce, tým → Práce/sekce,
                    obecný kontakt → Lidé/sekce, tag → konfigurovaný projekt, jinak fallback.
                    Pokud projekt/sekce neexistuje, Rašeliniště ji v Todoistu vytvoří
                    (auto-create se loguje v <a href="/settings/crons" class="underline">Routing audit logu</a>).
                  </p>
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground block mb-1">
                    Název projektu „Práce" (kam jdou úkoly s klient-* tagy + tým)
                  </label>
                  <Input
                    value={praceProjectName}
                    onChange={(e) => setPraceProjectName(e.target.value)}
                    placeholder="Práce"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground block mb-1">
                    Název projektu „Lidé" (kam jdou delegace na obecné kontakty)
                  </label>
                  <Input
                    value={peopleProjectName}
                    onChange={(e) => setPeopleProjectName(e.target.value)}
                    placeholder="Lidé"
                  />
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">
                    Mapping tag → projekt / sekce (pravidlo #5)
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
                    Když úkol obsahuje <strong>kterýkoli</strong> z tagů pravidla (např. <code>dum, doma, byt, chata</code>) a žádné vyšší pravidlo nesedlo, jde do tohoto projektu. Sekce volitelná. Pořadí pravidel = priorita (první match vyhrává).
                  </p>
                  <div className="space-y-3">
                    {tagRows.map((row, idx) => {
                      const tagsPreview = parseTagsPreview(row.tagsInput);
                      return (
                        <div
                          key={idx}
                          className="border border-border/60 rounded-lg p-3 space-y-2 bg-background/30"
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-1 space-y-2">
                              <div>
                                <label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground block mb-0.5">
                                  Název pravidla (volitelné)
                                </label>
                                <Input
                                  value={row.name}
                                  onChange={(e) => updateTagRow(idx, { name: e.target.value })}
                                  placeholder="např. Domov"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground block mb-0.5">
                                  Tagy (čárkou oddělené)
                                </label>
                                <Input
                                  value={row.tagsInput}
                                  onChange={(e) => updateTagRow(idx, { tagsInput: e.target.value })}
                                  placeholder="dum, doma, byt, chata"
                                />
                                {tagsPreview.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {tagsPreview.map((t) => (
                                      <span
                                        key={t}
                                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-tint-lavender/15 text-tint-lavender border border-tint-lavender/30"
                                      >
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground block mb-0.5">
                                    Projekt
                                  </label>
                                  <Input
                                    value={row.project}
                                    onChange={(e) => updateTagRow(idx, { project: e.target.value })}
                                    placeholder="Domov"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground block mb-0.5">
                                    Sekce (volitelná)
                                  </label>
                                  <Input
                                    value={row.section}
                                    onChange={(e) => updateTagRow(idx, { section: e.target.value })}
                                    placeholder=""
                                  />
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeTagRow(idx)}
                              className="p-1.5 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive shrink-0"
                              title="Smazat pravidlo"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    <Button variant="outline" size="sm" onClick={addTagRow}>
                      + Přidat pravidlo
                    </Button>
                  </div>
                </div>
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
