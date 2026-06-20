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
}

const TINTS = ["peach", "mint", "lavender", "sky", "sage", "butter", "rose", "pink"] as const;
type Tint = typeof TINTS[number];

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
      }
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Smazat tento odkaz?")) return;
    setLinks((prev) => prev.filter((l) => l.id !== id));
    await fetch(`/api/page-links/${id}`, { method: "DELETE" });
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
        <Button onClick={() => setCreating(true)}><Plus /> Nový odkaz</Button>
      ) : (
        <div className="glass rounded-xl p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
            Nový odkaz
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Název</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="např. ARES" className="mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">URL</label>
            <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://…" className="mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-2">Barva</label>
            <TintPicker value={newTint} onChange={setNewTint} />
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
        <div className="space-y-2">
          {links.map((link) => (
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
    </div>
  );
}

function PageLinkRow({
  link, busy, onUpdate, onRemove,
}: {
  link: PageLink;
  busy: boolean;
  onUpdate: (patch: Partial<PageLink>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(link.name);
  const [url, setUrl] = useState(link.url);
  const [tint, setTint] = useState<Tint>(link.tint as Tint);
  const [icon, setIcon] = useState(link.icon ?? "");

  function save() {
    onUpdate({
      name: name.trim() || link.name,
      url: url.trim() || link.url,
      tint,
      icon: icon.trim() || null,
    });
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="rounded-xl p-3 flex items-center gap-3 border border-border bg-card hover:bg-accent/30 transition">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => { e.preventDefault(); window.open(link.url, '_blank', 'noopener,noreferrer'); }}
          className="size-9 rounded-lg grid place-items-center shrink-0 border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition"
          title="Otevřít v nové záložce"
        >
          <Globe className="size-4" />
        </a>
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => { e.preventDefault(); window.open(link.url, '_blank', 'noopener,noreferrer'); }}
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
