import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, Check, X, AlertTriangle, Globe } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface PageLink {
  id: string;
  name: string;
  url: string;
  tint: string;
  icon: string | null;
  order: number;
  // Gideon 2026-08-06: "MEET" = sekce rychlého připojení (dlaždice na /start)
  section: string | null;
}

const TINTS = ["peach", "mint", "lavender", "sky", "sage", "butter", "rose", "pink"] as const;
type Tint = typeof TINTS[number];

/* Gideon 2026-08-07: „všechny page links ať se otvírají v browseru, ne
   v PWA." Dřívější lokální hack (externalHref + window.open s x-safari
   schématem) OBCHÁZEL globální zachytávač v Base.astro a v PWA se choval
   nespolehlivě (window.open s custom schématem iOS tiše zahazuje / otvírá
   in-app). Odkazy jsou teď čisté <a href="https://..."> — o otevření ve
   skutečném Safari se stará JEDINĚ globální capture handler v Base.astro. */

export default function PageLinksSettings() {
  const [links, setLinks] = useState<PageLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state pro nový link
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newTint, setNewTint] = useState<Tint>("sky");
  const [newIcon, setNewIcon] = useState("");
  const [newSection, setNewSection] = useState<"" | "MEET">("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/page-links");
      const data = await res.json();
      if (res.ok) setLinks(data.links);
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (!newName.trim() || !newUrl.trim()) {
      setError("Vyplň název a URL.");
      return;
    }
    setBusy("create");
    setError(null);
    try {
      const res = await fetch("/api/page-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newName,
          url: newUrl,
          tint: newTint,
          icon: newIcon.trim() || null,
          section: newSection || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Vytvoření selhalo.");
        return;
      }
      setLinks((prev) => [...prev, data.link]);
      setNewName("");
      setNewUrl("");
      setNewTint("sky");
      setNewIcon("");
      setNewSection("");
      setCreating(false);
    } finally {
      setBusy(null);
    }
  }

  async function update(id: string, patch: Partial<PageLink>) {
    setBusy(id);
    try {
      const res = await fetch(`/api/page-links/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setLinks((prev) => prev.map((l) => (l.id === id ? data.link : l)));
        return true;
      }
      const d = await res.json().catch(() => null);
      setError(d?.error ?? `Uložení odkazu selhalo (HTTP ${res.status}).`);
      return false;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Síťová chyba.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Smazat tento odkaz?")) return;
    const prev = links;
    setLinks((ls) => ls.filter((l) => l.id !== id));
    // AUDIT 2026-07-31: při selhání DELETE vrátit zpět (dřív odkaz zmizel
    // jen z UI a po reloadu se objevil znovu)
    const res = await fetch(`/api/page-links/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) setLinks(prev);
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground"><Loader2 className="inline animate-spin mr-2" />Načítám…</div>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Tlačítko + form pro nový */}
      {!creating ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => { setCreating(true); setNewSection(""); }}><Plus /> Nový odkaz</Button>
          {/* Gideon 2026-08-07 („v linkách furt nevidím ty meet"): sekce MEET
              byla schovaná až ve formuláři — viditelné tlačítko s předvolbou */}
          <Button variant="outline" onClick={() => { setCreating(true); setNewSection("MEET"); setNewTint("sky"); }}>
            <Plus /> Meet dlaždice (na /start)
          </Button>
        </div>
      ) : (
        <div className="glass rounded-xl p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
            Nový odkaz
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Název</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={newSection === "MEET" ? "Jméno — např. Karel (Avecomp)" : "např. ARES"} className="mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">URL</label>
            <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder={newSection === "MEET" ? "https://meet.google.com/xxx-xxxx-xxx" : "https://…"} className="mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-2">Barva</label>
            <TintPicker value={newTint} onChange={setNewTint} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-1">Sekce</label>
            <select
              value={newSection}
              onChange={(e) => setNewSection(e.target.value as "" | "MEET")}
              className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
            >
              <option value="">Běžný odkaz (sidebar)</option>
              <option value="MEET">MEET — rychlé připojení (dlaždice na /start)</option>
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">
              MEET: název = jméno člověka/klienta, URL = link jeho Meet místnosti. Klik na /start rovnou otevře schůzku.
            </p>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              Ikona (volitelně) — lowercase, kebab-case z{" "}
              <a href="https://lucide.dev/icons" target="_blank" rel="noopener" className="underline text-[var(--tint-sky)]">
                lucide.dev/icons
              </a>
            </label>
            <Input value={newIcon} onChange={(e) => setNewIcon(e.target.value)} placeholder="např. camera, image, video, globe" className="mt-1" />
            <p className="text-[11px] text-muted-foreground mt-1">
              Pokud nezadáš nebo zadáš neplatný název (např. „Immich"), použije se 🌐 globe.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={create} disabled={busy === "create"}>
              {busy === "create" ? <Loader2 className="animate-spin" /> : <Check />} Uložit
            </Button>
            <Button variant="ghost" onClick={() => { setCreating(false); setError(null); }}>
              <X /> Zrušit
            </Button>
          </div>
        </div>
      )}

      {/* List existujících linků */}
      {links.length === 0 ? (
        <div className="text-sm text-muted-foreground italic py-4">
          Zatím žádné odkazy. Klikni „Nový odkaz" výše.
        </div>
      ) : (
        <div className="space-y-4">
          {links.some((l) => l.section === "MEET") && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground px-1">
                MEET — rychlé připojení (na /start)
              </div>
              {links.filter((l) => l.section === "MEET").map((link) => (
                <PageLinkRow
                  key={link.id}
                  link={link}
                  busy={busy === link.id}
                  onUpdate={(patch) => update(link.id, patch)}
                  onRemove={() => remove(link.id)}
                />
              ))}
            </div>
          )}
          <div className="space-y-2">
            {links.some((l) => l.section === "MEET") && (
              <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground px-1">
                Běžné odkazy
              </div>
            )}
            {links.filter((l) => l.section !== "MEET").map((link) => (
              <PageLinkRow
                key={link.id}
                link={link}
                busy={busy === link.id}
                onUpdate={(patch) => update(link.id, patch)}
                onRemove={() => remove(link.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PageLinkRow({
  link, busy, onUpdate, onRemove,
}: {
  link: PageLink;
  busy: boolean;
  onUpdate: (patch: Partial<PageLink>) => Promise<boolean> | void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(link.name);
  const [url, setUrl] = useState(link.url);
  const [tint, setTint] = useState<Tint>(link.tint as Tint);
  const [icon, setIcon] = useState(link.icon ?? "");
  const [section, setSection] = useState<"" | "MEET">(link.section === "MEET" ? "MEET" : "");

  async function save() {
    const ok = await onUpdate({
      section: section || null,
      name: name.trim() || link.name,
      url: url.trim() || link.url,
      tint,
      icon: icon.trim() || null,
    });
    if (ok !== false) setEditing(false);
  }

  if (!editing) {
    return (
      <div className="rounded-xl p-3 flex items-center gap-3 border border-border bg-card hover:bg-accent/30 transition">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="size-9 rounded-lg grid place-items-center shrink-0 border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition"
          title="Otevřít v prohlížeči"
        >
          <Globe className="size-4" />
        </a>
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 min-w-0 no-underline text-foreground"
        >
          <div className="text-sm font-medium truncate">{link.name}</div>
          <div className="text-[11px] font-mono text-muted-foreground truncate">{link.url}</div>
        </a>
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
        >
          Upravit
        </button>
        <button
          onClick={onRemove}
          disabled={busy}
          className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </button>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-4 space-y-3 border border-[var(--tint-sky)]/30">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Název" />
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL" />
      <TintPicker value={tint} onChange={setTint} />
      <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="Ikona (volitelně, lucide name)" />
      <select
        value={section}
        onChange={(e) => setSection(e.target.value as "" | "MEET")}
        className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
      >
        <option value="">Běžný odkaz</option>
        <option value="MEET">MEET — rychlé připojení (/start)</option>
      </select>
      <div className="flex gap-2">
        <Button size="sm" onClick={save}><Check /> Uložit</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X /> Zrušit</Button>
      </div>
    </div>
  );
}

function TintPicker({ value, onChange }: { value: Tint; onChange: (t: Tint) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TINTS.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`size-10 rounded-lg border-2 transition ${
            value === t ? "border-foreground" : "border-white/10 hover:border-white/30"
          }`}
          style={{ background: `color-mix(in oklch, var(--tint-${t}) 40%, transparent)` }}
          title={t}
          type="button"
        />
      ))}
    </div>
  );
}
