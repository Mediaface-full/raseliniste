import { useState } from "react";
import { Plus, Trash2, MapPin, Loader2, Check, X, Edit3 } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Location {
  id: string;
  name: string;
  aliases: string[];
  commuteMinPeak: number;
  commuteMinOff: number;
  isLocal: boolean;
}

export default function LocationsAdmin({ initial }: { initial: Location[] }) {
  const [locations, setLocations] = useState<Location[]>(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state pro novou / editovanou lokaci
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [peak, setPeak] = useState("60");
  const [off, setOff] = useState("45");
  const [isLocal, setIsLocal] = useState(false);

  function startCreate() {
    setName("");
    setAliases("");
    setPeak("60");
    setOff("45");
    setIsLocal(false);
    setEditingId(null);
    setCreating(true);
    setError(null);
  }

  function startEdit(loc: Location) {
    setName(loc.name);
    setAliases(loc.aliases.join(", "));
    setPeak(String(loc.commuteMinPeak));
    setOff(String(loc.commuteMinOff));
    setIsLocal(loc.isLocal);
    setEditingId(loc.id);
    setCreating(false);
    setError(null);
  }

  function cancelForm() {
    setEditingId(null);
    setCreating(false);
  }

  async function save() {
    setBusy("save");
    setError(null);
    const payload = {
      name: name.trim(),
      aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean),
      commuteMinPeak: parseInt(peak) || 0,
      commuteMinOff: parseInt(off) || 0,
      isLocal,
    };
    try {
      const url = editingId ? `/api/calendar/locations/${editingId}` : "/api/calendar/locations";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Uložení selhalo.");
        return;
      }
      if (editingId) {
        setLocations((prev) => prev.map((l) => (l.id === editingId ? data.location : l)));
      } else {
        setLocations((prev) => [...prev, data.location].sort((a, b) => a.name.localeCompare(b.name)));
      }
      cancelForm();
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string, locName: string) {
    if (!confirm(`Smazat lokaci „${locName}"?`)) return;
    setBusy(`del-${id}`);
    try {
      const res = await fetch(`/api/calendar/locations/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Smazání selhalo.");
        return;
      }
      setLocations((prev) => prev.filter((l) => l.id !== id));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl">Lokace</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Města kde se schůzky odehrávají + commute časy. Slouží pro pravidla a budoucí parser.
          </p>
        </div>
        {!creating && !editingId && (
          <Button onClick={startCreate}><Plus /> Přidat</Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{error}</div>
      )}

      {(creating || editingId) && (
        <div className="glass rounded-xl p-5 space-y-3" style={{ ["--c" as string]: "var(--tint-sky)" }}>
          <h2 className="font-serif text-lg">{editingId ? "Upravit" : "Nová lokace"}</h2>
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">Název</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Praha, Plzeň, Brno, Hradec…" />
          </div>
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">Aliasy (čárkou oddělené)</label>
            <Input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Prague, Vinohrady, Smíchov" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Commute špička (min)</label>
              <Input type="number" min="0" value={peak} onChange={(e) => setPeak(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Commute mimo špičku (min)</label>
              <Input type="number" min="0" value={off} onChange={(e) => setOff(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isLocal}
              onChange={(e) => setIsLocal(e.target.checked)}
              className="size-4"
            />
            Lokální (domov / žádný commute)
          </label>
          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={Boolean(busy) || !name.trim()}>
              {busy === "save" ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Check /> Uložit</>}
            </Button>
            <Button variant="ghost" onClick={cancelForm}><X /> Zrušit</Button>
          </div>
        </div>
      )}

      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase font-mono text-muted-foreground border-b border-white/5">
              <th className="text-left px-4 py-3">Název</th>
              <th className="text-left px-4 py-3">Aliasy</th>
              <th className="text-right px-4 py-3">Špička</th>
              <th className="text-right px-4 py-3">Mimo</th>
              <th className="text-center px-4 py-3">Lokální</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 && (
              <tr><td colSpan={6} className="text-center text-muted-foreground py-6 italic">
                Žádné lokace. Přidej Prahu, Plzeň, Brno…
              </td></tr>
            )}
            {locations.map((l) => (
              <tr key={l.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                <td className="px-4 py-3 font-medium flex items-center gap-2">
                  <MapPin className="size-3.5 text-muted-foreground" /> {l.name}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                  {l.aliases.length > 0 ? l.aliases.join(", ") : "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{l.commuteMinPeak} min</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{l.commuteMinOff} min</td>
                <td className="px-4 py-3 text-center">{l.isLocal ? "" : "—"}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => startEdit(l)} className="p-1.5 rounded hover:bg-white/10 text-muted-foreground" title="Upravit">
                      <Edit3 className="size-3.5" />
                    </button>
                    <button onClick={() => remove(l.id, l.name)} disabled={busy === `del-${l.id}`} className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground" title="Smazat">
                      {busy === `del-${l.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
