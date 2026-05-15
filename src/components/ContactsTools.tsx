/**
 * Rozbalovací nástroje pod tabulkou kontaktů (kontakty_brief.md 5.8 + 5.9).
 *
 * Sedm sekcí:
 *   A) Validace — počty bez tel/email/skupiny/firmy
 *   B) Duplicity v iCloudu (mounted ContactsDuplicates)
 *   C) Find & Replace
 *   D) Normalizace +420
 *   E) Import VCF/CSV
 *   F) Obnova ze zálohy
 *   G) Google Workspace
 *   H) Export
 *
 * Každá sekce má vlastní expand/collapse stav. Defaultně zavřené.
 */

import { useState } from "react";
import {
  ChevronDown, ChevronRight, Search, RefreshCw, Phone, Upload, History,
  Cloud, Download, Loader2, AlertTriangle, Check, FileText, Replace,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import ContactsDuplicates from "./ContactsDuplicates";

type SectionKey = "validation" | "duplicates" | "find-replace" | "phones-420" | "import" | "backups" | "google" | "export";

export default function ContactsTools({ groupNames, companyNames = [] }: { groupNames: string[]; companyNames?: string[] }) {
  const [open, setOpen] = useState<Set<SectionKey>>(new Set());
  function toggle(key: SectionKey) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <h2 className="font-serif text-xl tracking-tight">Nástroje</h2>

      <CleanupEntitiesBanner />

      <DiagnoseSection />

      <Section title="Validace" icon={<Search className="size-4" />} isOpen={open.has("validation")} onToggle={() => toggle("validation")}>
        <ValidationSection />
      </Section>

      <Section title="Duplicity v iCloudu" icon={<RefreshCw className="size-4" />} isOpen={open.has("duplicates")} onToggle={() => toggle("duplicates")}>
        <ContactsDuplicates />
      </Section>

      <Section title="Find & Replace" icon={<Replace className="size-4" />} isOpen={open.has("find-replace")} onToggle={() => toggle("find-replace")}>
        <FindReplaceSection />
      </Section>

      <Section title="Normalizace +420 (CZ telefony)" icon={<Phone className="size-4" />} isOpen={open.has("phones-420")} onToggle={() => toggle("phones-420")}>
        <PhonesNormalizationSection />
      </Section>

      <Section title="Import VCF/CSV" icon={<Upload className="size-4" />} isOpen={open.has("import")} onToggle={() => toggle("import")}>
        <ImportSection />
      </Section>

      <Section title="Obnova ze zálohy" icon={<History className="size-4" />} isOpen={open.has("backups")} onToggle={() => toggle("backups")}>
        <BackupsSection />
      </Section>

      <Section title="Google Workspace" icon={<Cloud className="size-4" />} isOpen={open.has("google")} onToggle={() => toggle("google")}>
        <GoogleSection />
      </Section>

      <Section title="Export VCF/CSV" icon={<Download className="size-4" />} isOpen={open.has("export")} onToggle={() => toggle("export")}>
        <ExportSection groupNames={groupNames} companyNames={companyNames} />
      </Section>
    </div>
  );
}

// ===========================================================================
// Cleanup HTML entities banner — Petr 2026-05-15: po prvním iCloud sync
// jsou v DB `&#13;` v emailech/telefonech/jménech. Banner vidí jen pokud
// detekuje entity → 1 klik vyčistí.
// ===========================================================================
function CleanupEntitiesBanner() {
  const [busy, setBusy] = useState<"cleanup" | "merge" | "nuclear" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function runNuclear() {
    const userInput = prompt(
      "NUCLEAR RESET — smaže všechny kontakty BEZ overlay flagů (VIP/tým/clientTag/aliases/callLogToken jsou ZACHOVÁNY).\n\n" +
      "Pak klikneš 'Synchronizovat s iCloudem' a importuje se čistý dataset z iCloudu.\n\n" +
      "Pro potvrzení napiš: SMAZAT",
    );
    if (userInput !== "SMAZAT") return;
    setBusy("nuclear");
    setError(null);
    try {
      const res = await fetch("/api/contacts/nuclear-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "NUCLEAR_RESET" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Reset selhal.");
        return;
      }
      setResult(`✓ Smazáno ${data.deleted} kontaktů. Zachováno ${data.keptOverlay} (VIP/tým/clientTag/aliases). V DB zbývá ${data.finalCount}. Teď klikni 'Synchronizovat s iCloudem'.`);
      setDone(true);
      setTimeout(() => window.location.reload(), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runCleanup() {
    if (!confirm("Vyčistit HTML entities (`&#13;` apod.) z kontaktů + telefonů + emailů + skupin? Plus smazat prázdné kontakty. Idempotentní.")) return;
    setBusy("cleanup");
    setError(null);
    try {
      const res = await fetch("/api/contacts/cleanup-entities", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Cleanup selhal.");
        return;
      }
      const s = data.stats;
      setResult(`✓ Vyčištěno ${s.contactsUpdated} kontaktů, ${s.phonesUpdated} tel, ${s.emailsUpdated} emailů, ${s.duplicatesDeleted} duplikátů uvnitř kontaktů, ${s.emptyContactsDeleted ?? 0} prázdných kontaktů smazáno.`);
      setDone(true);
      setTimeout(() => window.location.reload(), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runAutoMerge() {
    if (!confirm(
      "Auto-merge VŠECHNY duplicity najednou (union-find podle jména/telefonu/emailu).\n\n" +
      "Primárka se vybere podle priority:\n" +
      "  1. VIP / callLogToken / clientTag / aliases (overlay)\n" +
      "  2. icloudUid set\n" +
      "  3. Nejstarší createdAt\n\n" +
      "Sekundární kontakty se sloučí (telefony/emaily/skupiny union, overlay zachován) a smažou.\n" +
      "Před každým mergem auto-záloha.",
    )) return;
    setBusy("merge");
    setError(null);
    try {
      const res = await fetch("/api/contacts/auto-merge", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Auto-merge selhal.");
        return;
      }
      setResult(`✓ Sloučeno ${data.mergedClusters} clusterů, smazáno ${data.contactsRemoved} duplicitních kontaktů. Chyby: ${data.errors}.`);
      setDone(true);
      setTimeout(() => window.location.reload(), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (done && result) {
    return (
      <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-4 py-3 flex items-center gap-2">
        <Check className="size-4 text-[var(--tint-sage)]" />
        {result} Refresh za 3 s…
      </div>
    );
  }

  return (
    <div className="glass-strong rounded-xl p-4 space-y-3" style={{ borderLeft: "4px solid var(--tint-rose)" }}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="size-5 text-[var(--tint-rose)] mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="font-medium text-sm">Sanitace po prvním iCloud sync</div>
          <p className="text-xs text-muted-foreground mt-1">
            Po prvním sync se v DB objevily <code>&amp;#13;</code> v emailech/telefonech, prázdné kontakty a duplicity.
            Doporučený postup: <strong>1) Vyčistit entity</strong> → <strong>2) Auto-merge duplicity</strong>.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={runCleanup} disabled={busy !== null} className="bg-[var(--tint-rose)]/20 text-[var(--tint-rose)] border-[var(--tint-rose)]/40">
          {busy === "cleanup" ? <><Loader2 className="size-4 animate-spin" /> Čistím…</> : "1) Vyčistit entity + prázdné"}
        </Button>
        <Button onClick={runAutoMerge} disabled={busy !== null} className="bg-[var(--tint-sage)]/20 text-[var(--tint-sage)] border-[var(--tint-sage)]/40">
          {busy === "merge" ? <><Loader2 className="size-4 animate-spin" /> Slučuji…</> : "2) Auto-merge duplicity"}
        </Button>
        <Button onClick={runNuclear} disabled={busy !== null} className="bg-destructive/20 text-destructive border-destructive/40 ml-auto" title="Smaže všechny non-overlay kontakty. Zachová jen VIP/tým/clientTag/aliases.">
          {busy === "nuclear" ? <><Loader2 className="size-4 animate-spin" /> Mažu…</> : "💣 Nuclear reset"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground border-t border-white/5 pt-2 mt-2">
        💣 <strong>Nuclear reset</strong> = smaže VŠECHNY kontakty bez overlay flagů (VIP/tým/clientTag/aliases zachovány).
        Pak klikneš „Synchronizovat s iCloudem" v hero → naimportuje čistý dataset z iCloudu. Použij pokud cleanup+merge nestíhá.
      </p>
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}

// ===========================================================================
// Diagnostika — kdo, odkud, kdy. Pro Petra 2026-05-15 — chce vidět kde se
// duplicity berou.
// ===========================================================================
function DiagnoseSection() {
  const [data, setData] = useState<{
    total: number;
    bySyncSource: { syncSource: string; count: number }[];
    byImportedFrom: { importedFrom: string; count: number }[];
    overlay: Record<string, number>;
    duplicates: { clusters: number; wouldRemoveByMerge: number; top5Examples: Array<{ contactCount: number; reasons: string[]; contacts: Array<{ displayName: string; phones: string[]; emails: string[]; syncSource: string | null }> }> };
    recent20: Array<{ name: string; syncSource: string; importedFrom: string; hasIcloudUid: boolean; hasGoogleResourceName: boolean; createdAt: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/contacts/diagnose");
      const json = await res.json();
      if (res.ok) setData(json);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass rounded-xl p-4 space-y-3" style={{ ["--c" as string]: "var(--tint-butter)" }}>
      <div className="flex items-center gap-2">
        <Search className="size-4" style={{ color: "var(--c)" }} />
        <h3 className="font-medium text-sm">Diagnostika — kde se kontakty berou</h3>
        <Button onClick={load} disabled={loading} className="ml-auto" variant="outline">
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {data ? "Refresh" : "Spočítat"}
        </Button>
      </div>

      {data && (
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <div className="font-mono text-lg font-medium">{data.total} kontaktů celkem</div>
            <div className="text-xs text-muted-foreground mt-1">
              Duplicit (clusters): {data.duplicates.clusters} · po auto-merge by zbylo {data.total - data.duplicates.wouldRemoveByMerge}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-xs font-mono uppercase text-muted-foreground mb-1">Podle syncSource</div>
              {data.bySyncSource.map((b, i) => (
                <div key={i} className="flex justify-between text-xs"><span>{b.syncSource}</span><span className="font-mono">{b.count}</span></div>
              ))}
            </div>
            <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-xs font-mono uppercase text-muted-foreground mb-1">Podle importedFrom</div>
              {data.byImportedFrom.map((b, i) => (
                <div key={i} className="flex justify-between text-xs"><span>{b.importedFrom}</span><span className="font-mono">{b.count}</span></div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <div className="text-xs font-mono uppercase text-muted-foreground mb-1">Overlay + identifikátory</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              {Object.entries(data.overlay).map(([k, v]) => (
                <div key={k} className="flex justify-between"><span>{k}</span><span className="font-mono">{v}</span></div>
              ))}
            </div>
          </div>

          {data.duplicates.top5Examples.length > 0 && (
            <details className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
              <summary className="cursor-pointer text-xs font-mono uppercase text-muted-foreground">Top 5 příkladů duplicit</summary>
              <div className="mt-2 space-y-2 text-xs">
                {data.duplicates.top5Examples.map((ex, i) => (
                  <div key={i} className="border-t border-white/5 pt-2">
                    <div className="font-medium">{ex.contactCount}× duplicate — {ex.reasons.slice(0, 2).join(" · ")}</div>
                    {ex.contacts.map((c, j) => (
                      <div key={j} className="ml-2 text-muted-foreground">
                        • {c.displayName} <span className="font-mono opacity-60">[{c.syncSource ?? "?"}]</span>
                        {c.phones.length > 0 && <span className="ml-2">📞 {c.phones.join(", ")}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}

          <details className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <summary className="cursor-pointer text-xs font-mono uppercase text-muted-foreground">20 nejnovějších kontaktů</summary>
            <div className="mt-2 space-y-1 text-xs max-h-60 overflow-y-auto">
              {data.recent20.map((c, i) => (
                <div key={i} className="flex justify-between border-b border-white/5 pb-0.5">
                  <span>{c.name || "(bez jména)"}</span>
                  <span className="font-mono text-muted-foreground">
                    {c.hasIcloudUid ? "iCloud" : ""}{c.hasGoogleResourceName ? " G" : ""}
                    {" · "}{c.syncSource}
                    {" · "}{new Date(c.createdAt).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function Section({
  title, icon, isOpen, onToggle, children,
}: { title: string; icon: React.ReactNode; isOpen: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-white/5"
      >
        {isOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        {icon}
        <span className="font-medium">{title}</span>
      </button>
      {isOpen && <div className="border-t border-white/5 p-4">{children}</div>}
    </div>
  );
}

// ===========================================================================
// A) VALIDACE
// ===========================================================================
function ValidationSection() {
  const [counts, setCounts] = useState<{ [k: string]: number } | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/contacts/tabulka?pageSize=1");
      const data = await res.json();
      if (res.ok) setCounts(data.validationCounts ?? null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={load} disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
        Spočítat validační kategorie
      </Button>
      {counts && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
          {Object.entries(counts).map(([key, count]) => (
            <div key={key} className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm">
              <div className="font-mono text-lg">{count}</div>
              <div className="text-xs text-muted-foreground">{key}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// C) FIND & REPLACE
// ===========================================================================
function FindReplaceSection() {
  const [column, setColumn] = useState("displayName");
  const [find, setFind] = useState("");
  const [replaceVal, setReplaceVal] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [preview, setPreview] = useState<Array<{ contactId: string; displayName: string; field: string; before: string; after: string }> | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function previewChanges() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/contacts/find-replace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ column, find, replace: replaceVal, regex, caseSensitive, action: "preview" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Preview selhal.");
        return;
      }
      setPreview(data.preview);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!confirm(`Aplikovat na ${total} změn? Akce je nevratná (kromě obnovy ze zálohy).`)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/contacts/find-replace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ column, find, replace: replaceVal, regex, caseSensitive, action: "apply" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Apply selhal.");
        return;
      }
      setSuccess(`✓ ${data.updated} změn aplikováno.`);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <select value={column} onChange={(e) => setColumn(e.target.value)} className="px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm">
          <option value="displayName">Jméno (display)</option>
          <option value="firstName">Křestní jméno</option>
          <option value="lastName">Příjmení</option>
          <option value="company">Firma</option>
          <option value="note">Poznámka</option>
          <option value="phones">Telefony</option>
          <option value="emails">E-maily</option>
        </select>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
            <span>Regex</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
            <span>Citlivé na velikost</span>
          </label>
        </div>
      </div>
      <Input placeholder="Co hledat" value={find} onChange={(e) => setFind(e.target.value)} />
      <Input placeholder="Čím nahradit" value={replaceVal} onChange={(e) => setReplaceVal(e.target.value)} />
      <div className="flex gap-2">
        <Button onClick={previewChanges} disabled={loading || !find}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Náhled
        </Button>
        {preview && preview.length > 0 && (
          <Button onClick={apply} disabled={loading} className="bg-[var(--tint-rose)]/20 text-[var(--tint-rose)] border-[var(--tint-rose)]/40">
            Aplikovat na {total} změn
          </Button>
        )}
      </div>
      {preview && (
        <div className="rounded-md border border-white/10 bg-black/20 max-h-60 overflow-y-auto">
          <div className="text-xs font-mono text-muted-foreground px-3 py-1.5 border-b border-white/5">
            Náhled (prvních {preview.length} z {total}):
          </div>
          {preview.map((p, i) => (
            <div key={i} className="px-3 py-2 text-sm border-b border-white/5 last:border-0">
              <div className="font-medium text-xs">{p.displayName} <span className="text-muted-foreground">({p.field})</span></div>
              <div className="text-xs text-muted-foreground font-mono">
                <span className="line-through opacity-60">{p.before}</span> → <span className="text-[var(--tint-sage)]">{p.after}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {success && <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2"><Check className="size-4" /> {success}</div>}
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2"><AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}</div>}
    </div>
  );
}

// ===========================================================================
// D) NORMALIZACE +420
// ===========================================================================
function PhonesNormalizationSection() {
  const [candidates, setCandidates] = useState<Array<{ phoneId: string; contactName: string; original: string; normalized: string; confidence: "high" | "ambiguous" }> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function findCandidates() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/contacts/normalize-phones");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Selhalo.");
        return;
      }
      setCandidates(data.candidates);
      // Default: zaškrt high confidence
      setSelected(new Set(data.candidates.filter((c: { confidence: string }) => c.confidence === "high").map((c: { phoneId: string }) => c.phoneId)));
    } finally {
      setLoading(false);
    }
  }

  async function applySelected() {
    if (selected.size === 0) return;
    if (!confirm(`Normalizovat ${selected.size} telefonů na formát +420 XXX XXX XXX?`)) return;
    setLoading(true);
    try {
      const res = await fetch("/api/contacts/normalize-phones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Selhalo.");
        return;
      }
      setSuccess(`✓ ${data.updated} telefonů normalizováno.`);
      setCandidates(null);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Detekuje 9místné domácí telefony a navrhne formát <code>+420 XXX XXX XXX</code>. Mezinárodní (s <code>+</code> nebo <code>00</code>) se přeskakují.
        🟢 <strong>CZ likely</strong> = CZ rozsahy (mobile 60[1-8], 70[2-9], 72-77x, 79x; pevné 2x-5x). 🟡 <strong>ambiguous</strong> = 9 číslic ale ne CZ.
      </p>
      <Button onClick={findCandidates} disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />} Najít kandidáty
      </Button>
      {candidates && (
        <>
          <div className="rounded-md border border-white/10 bg-black/20 max-h-60 overflow-y-auto">
            {candidates.map((c) => (
              <label key={c.phoneId} className="flex items-center gap-2 px-3 py-2 text-sm border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={selected.has(c.phoneId)}
                  onChange={(e) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(c.phoneId);
                      else next.delete(c.phoneId);
                      return next;
                    });
                  }}
                />
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${c.confidence === "high" ? "bg-[var(--tint-sage)]/15 text-[var(--tint-sage)]" : "bg-[var(--tint-butter)]/15 text-[var(--tint-butter)]"}`}>
                  {c.confidence === "high" ? "🟢" : "🟡"}
                </span>
                <span className="flex-1 truncate">{c.contactName}</span>
                <span className="text-xs text-muted-foreground font-mono"><span className="opacity-60">{c.original}</span> → <span className="text-[var(--tint-sage)]">{c.normalized}</span></span>
              </label>
            ))}
          </div>
          <Button onClick={applySelected} disabled={loading || selected.size === 0}>
            Normalizovat {selected.size} vybraných
          </Button>
        </>
      )}
      {success && <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2"><Check className="size-4" /> {success}</div>}
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2"><AlertTriangle className="size-4 inline mr-1" /> {error}</div>}
    </div>
  );
}

// ===========================================================================
// E) IMPORT VCF/CSV
// ===========================================================================
function ImportSection() {
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<{ totalParsed: number; newContacts: number; collisions: number; collisionsList: Array<{ importedName: string; matchedName: string; matchReason: string }> } | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "preview" | "apply") {
    if (!file) return;
    setLoading(true);
    setError(null);
    if (action === "preview") setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("overwrite", overwrite ? "1" : "0");
      fd.append("action", action);
      const res = await fetch("/api/contacts/import-vcf-csv", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import selhal.");
        return;
      }
      if (action === "preview") setPreview(data);
      else { setResult(data); setPreview(null); setFile(null); }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <input
          type="file"
          accept=".vcf,.csv,text/vcard,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        {file && <div className="text-xs text-muted-foreground mt-1">{file.name} · {Math.round(file.size / 1024)} KB</div>}
      </label>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
        <span>Přepsat existující při kolizi (jinak skip)</span>
      </label>
      <div className="flex gap-2">
        <Button onClick={() => submit("preview")} disabled={loading || !file}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Náhled
        </Button>
        {preview && (
          <Button onClick={() => submit("apply")} disabled={loading} className="bg-[var(--tint-sage)]/20 text-[var(--tint-sage)] border-[var(--tint-sage)]/40">
            Importovat {preview.newContacts} nových {overwrite ? `+ přepsat ${preview.collisions}` : `(skip ${preview.collisions} kolizí)`}
          </Button>
        )}
      </div>
      {preview && (
        <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 space-y-1 text-sm">
          <div>Načteno: <strong>{preview.totalParsed}</strong></div>
          <div className="text-[var(--tint-sage)]">Nové: <strong>{preview.newContacts}</strong></div>
          <div className="text-[var(--tint-rose)]">Kolize: <strong>{preview.collisions}</strong></div>
          {preview.collisionsList.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Detail kolizí</summary>
              <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
                {preview.collisionsList.map((c, i) => (
                  <div key={i}>{c.importedName} ↔ {c.matchedName} ({c.matchReason})</div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {result && (
        <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2">
          <Check className="size-4 text-[var(--tint-sage)]" />
          Vytvořeno {result.created}, updated {result.updated}, skipped {result.skipped}, chyby {result.errors}.
        </div>
      )}
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2"><AlertTriangle className="size-4 inline mr-1" /> {error}</div>}
    </div>
  );
}

// ===========================================================================
// F) BACKUPS + RESTORE
// ===========================================================================
function BackupsSection() {
  const [backups, setBackups] = useState<Array<{ id: string; displayName: string; action: string; createdAt: string }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/contacts/backups");
      const data = await res.json();
      if (res.ok) setBackups(data.backups);
    } finally {
      setLoading(false);
    }
  }

  async function restore(id: string) {
    if (!confirm("Obnovit tuto zálohu? Pokud kontakt stále existuje, jeho data se přepíší zálohovanou verzí.")) return;
    setRestoring(id);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/contacts/backups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backupId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Restore selhal.");
        return;
      }
      setSuccess("✓ Záloha obnovena.");
      void load();
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Posledních 80 záloh vytvořených automaticky před změnou (PUT do iCloudu), mazáním nebo sloučením duplicit.
      </p>
      <Button onClick={load} disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <History className="size-4" />} Načíst zálohy
      </Button>
      {backups && (
        <div className="rounded-md border border-white/10 bg-black/20 max-h-80 overflow-y-auto">
          {backups.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center italic">Žádné zálohy.</div>
          ) : backups.map((b) => (
            <div key={b.id} className="px-3 py-2 text-sm border-b border-white/5 last:border-0 flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{b.displayName}</div>
                <div className="text-xs text-muted-foreground font-mono">
                  {b.action} · {new Date(b.createdAt).toLocaleString("cs-CZ")}
                </div>
              </div>
              <button
                onClick={() => restore(b.id)}
                disabled={restoring === b.id}
                className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50"
              >
                {restoring === b.id ? <Loader2 className="size-3 animate-spin inline" /> : "Obnovit"}
              </button>
            </div>
          ))}
        </div>
      )}
      {success && <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2"><Check className="size-4" /> {success}</div>}
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2"><AlertTriangle className="size-4 inline mr-1" /> {error}</div>}
    </div>
  );
}

// ===========================================================================
// G) GOOGLE WORKSPACE
// ===========================================================================
function GoogleSection() {
  const [syncing, setSyncing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [pullingBack, setPullingBack] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pullBackCandidates, setPullBackCandidates] = useState<Array<{ resourceName: string; fn: string; phones: string[]; emails: string[] }> | null>(null);

  async function pushAll() {
    if (!confirm(
      "OBOUSMĚRNÝ sync Rašeliniště ↔ Google Workspace.\n\n" +
      "• Stáhne změny z Google (nové kontakty, úpravy)\n" +
      "• Pošle naše změny do Google (last-write-wins podle timestamp)\n" +
      "• 3-úrovňové párování proti duplicitám\n" +
      "• Overlay pole (VIP, aliasy, klient slug) se NEPŘEPISUJÍ z Googlu\n\n" +
      "Pokud chybí Google scope 'contacts', proběhne reauth.",
    )) return;
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/contacts/google/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "all", direction: "bidirectional" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Sync selhal. Pravděpodobně chybí Google contacts scope — reauth v /settings/integrations/google.");
        return;
      }
      setResult(
        `✓ Sync hotov (${(data.durationMs / 1000).toFixed(1)} s).\n` +
        `Z Google → DB: vytvořeno ${data.pulledCreated}, update ${data.pulledUpdated}.\n` +
        `DB → Google: vytvořeno ${data.created}, update ${data.updated}, skipped ${data.skipped}.\n` +
        `Chyby: ${data.errors}.`,
      );
    } finally {
      setSyncing(false);
    }
  }

  async function cleanupDuplicates() {
    if (!confirm("Najít a smazat duplicity v Googlu (union-find). Zachová se vždy ten s naším resourceName, ostatní se smažou. Toto je nevratné na Google straně.")) return;
    setCleaning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/contacts/google/cleanup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Selhalo.");
        return;
      }
      if (data.errors > 0 && data.errorMessages?.length > 0) {
        // Detailní chyba pro Petra — typicky scope insufficient po prvním sync
        const hasAuthError = data.errorMessages.some((m: string) => /403|401|insufficient|scope|permission/i.test(m));
        if (hasAuthError) {
          setError(
            `Google delete vrací chybu autorizace — pravděpodobně chybí scope \`contacts\` (write). ` +
            `Otevři /settings/integrations/google a klikni Reautorizovat. Detail: ${data.errorMessages[0]}`,
          );
        } else {
          setError(`Detail chyby: ${data.errorMessages.join(" | ")}`);
        }
      }
      setResult(`Zpracováno ${data.clustersProcessed} clusterů, smazáno ${data.deleted}, chyby ${data.errors}.`);
    } finally {
      setCleaning(false);
    }
  }

  async function loadPullBack() {
    setPullingBack(true);
    setError(null);
    try {
      const res = await fetch("/api/contacts/google/pullback");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Selhalo.");
        return;
      }
      setPullBackCandidates(data.candidates);
    } finally {
      setPullingBack(false);
    }
  }

  async function applyPullBack() {
    if (!pullBackCandidates || pullBackCandidates.length === 0) return;
    if (!confirm(`Nahrát ${pullBackCandidates.length} kontaktů z Googlu do Rašeliniště?`)) return;
    setPullingBack(true);
    try {
      const res = await fetch("/api/contacts/google/pullback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceNames: pullBackCandidates.map((c) => c.resourceName) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Selhalo.");
        return;
      }
      setResult(`✓ Nahráno ${data.created} kontaktů z Googlu, chyby ${data.errors}.`);
      setPullBackCandidates(null);
    } finally {
      setPullingBack(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <strong>Obousměrný sync</strong> Rašeliniště ↔ Google Workspace (People API). Stáhne nové z Google,
        pošle naše změny tam (last-write-wins podle timestamp). 3-úrovňové párování proti duplicitám.
        Vyžaduje <code>contacts</code> OAuth scope — pokud chybí, proběhne reauth v{" "}
        <a href="/settings/integrations/google" className="underline">Google integration</a>.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={pushAll} disabled={syncing}>
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <Cloud className="size-4" />} Synchronizovat s Google
        </Button>
        <Button variant="outline" onClick={cleanupDuplicates} disabled={cleaning}>
          {cleaning ? <Loader2 className="size-4 animate-spin" /> : null} Vyčistit duplicity v Google
        </Button>
        <Button variant="outline" onClick={loadPullBack} disabled={pullingBack}>
          {pullingBack ? <Loader2 className="size-4 animate-spin" /> : null} Najít kontakty jen v Google (preview)
        </Button>
      </div>
      {pullBackCandidates && (
        <div className="rounded-md border border-white/10 bg-black/20 max-h-60 overflow-y-auto">
          <div className="text-xs font-mono px-3 py-1.5 border-b border-white/5 text-muted-foreground">
            {pullBackCandidates.length} kontaktů jen v Google:
          </div>
          {pullBackCandidates.slice(0, 30).map((c) => (
            <div key={c.resourceName} className="px-3 py-2 text-sm border-b border-white/5 last:border-0">
              <div className="font-medium">{c.fn}</div>
              <div className="text-xs text-muted-foreground font-mono">
                {c.phones.length > 0 ? `📞 ${c.phones.length}` : ""}{c.emails.length > 0 ? ` ✉ ${c.emails.length}` : ""}
              </div>
            </div>
          ))}
          {pullBackCandidates.length > 30 && (
            <div className="text-xs text-muted-foreground px-3 py-1.5">+{pullBackCandidates.length - 30} dalších</div>
          )}
          <div className="px-3 py-2 border-t border-white/5">
            <Button onClick={applyPullBack} disabled={pullingBack}>Nahrát všechny do Rašeliniště</Button>
          </div>
        </div>
      )}
      {result && <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2"><Check className="size-4" /> {result}</div>}
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2"><AlertTriangle className="size-4 inline mr-1" /> {error}</div>}
    </div>
  );
}

// ===========================================================================
// H) EXPORT
// ===========================================================================
function ExportSection({ groupNames, companyNames }: { groupNames: string[]; companyNames: string[] }) {
  const [scope, setScope] = useState("all");
  const [format, setFormat] = useState<"vcf" | "csv">("vcf");
  const [firemni, setFiremni] = useState(false);

  function buildUrl() {
    const params = new URLSearchParams();
    params.set("format", format);
    params.set("scope", scope);
    if (firemni) params.set("firemni", "1");
    return `/api/contacts/export?${params.toString()}`;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <select value={scope} onChange={(e) => setScope(e.target.value)} className="px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm">
          <option value="all">Všichni</option>
          {companyNames.length > 0 && (
            <optgroup label="Podle firmy">
              {companyNames.map((c) => (
                <option key={`company:${c}`} value={`company:${c}`}>🏢 {c}</option>
              ))}
            </optgroup>
          )}
          {groupNames.length > 0 && (
            <optgroup label="Podle skupiny">
              {groupNames.map((g) => (
                <option key={`group:${g}`} value={`group:${g}`}>📁 {g}</option>
              ))}
            </optgroup>
          )}
        </select>
        <select value={format} onChange={(e) => setFormat(e.target.value as "vcf" | "csv")} className="px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm">
          <option value="vcf">VCF (vCard 3.0 — 1 soubor pro všechny)</option>
          <option value="csv">CSV (středník, UTF-8 BOM, Excel)</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={firemni} onChange={(e) => setFiremni(e.target.checked)} />
        <span>🏢 Firemní export (jen Jméno, Příjmení, Firma, Telefon, Druhý telefon, Narozeniny, E-mail)</span>
      </label>
      <a href={buildUrl()} download className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--tint-sage)]/20 text-[var(--tint-sage)] border border-[var(--tint-sage)]/40 text-sm font-medium hover:bg-[var(--tint-sage)]/30">
        <Download className="size-4" /> Stáhnout {format.toUpperCase()}
      </a>
      <p className="text-xs text-muted-foreground">
        VCF = jeden soubor obsahující všechny kontakty z výběru (i 50+ v jednom file). Ideální pro import jinam.
      </p>
    </div>
  );
}
