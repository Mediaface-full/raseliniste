import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2, Upload, RefreshCw, CalendarDays } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface LocalCalendar {
  id: string;
  name: string;
  filename: string;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function LocalCalendarsManager() {
  const [calendars, setCalendars] = useState<LocalCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  // Re-upload cíl: id kalendáře jehož obsah nahradit, null = nový kalendář
  const replaceTarget = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/local-calendars");
      const data = await res.json();
      if (res.ok) setCalendars(data.calendars);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function pickFile(calendarId: string | null) {
    replaceTarget.current = calendarId;
    fileInput.current?.click();
  }

  async function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setNotice(null);
    setUploading(true);
    try {
      const target = replaceTarget.current;
      const imported: string[] = [];
      for (const file of Array.from(files)) {
        const icsText = await file.text();
        const res = await fetch("/api/local-calendars", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            // Jméno z pole má smysl jen pro první soubor nového uploadu;
            // u vícenásobného výběru pojmenují další soubory samy sebe
            name: !target && imported.length === 0 && newName.trim()
              ? newName.trim()
              : file.name.replace(/\.ics$/i, ""),
            filename: file.name,
            icsText,
            ...(target ? { calendarId: target } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(`${file.name}: ${data.error ?? "chyba uploadu"}`);
          break;
        }
        imported.push(`${data.name} (${data.eventCount} událostí${data.truncated ? ", zkráceno" : ""})`);
        if (target) break; // replace bere jen první soubor
      }
      if (imported.length > 0) setNotice(`Importováno: ${imported.join(", ")}`);
      setNewName("");
      await load();
    } catch {
      setError("Soubor se nepodařilo přečíst.");
    } finally {
      setUploading(false);
      replaceTarget.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove(cal: LocalCalendar) {
    if (!confirm(`Smazat kalendář „${cal.name}" včetně ${cal.eventCount} událostí?`)) return;
    const res = await fetch(`/api/local-calendars/${cal.id}`, { method: "DELETE" });
    if (res.ok) {
      setNotice(`Kalendář „${cal.name}" smazán.`);
      await load();
    } else {
      setError("Smazání se nepovedlo.");
    }
  }

  if (loading) {
    return (
      <div className="glass rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Načítám…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-xl">Nahrané kalendáře (.ics)</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Zobrazí se v Plánu i v denním, týdenním a měsíčním pohledu se štítkem „ics".
          Jsou čistě informativní — nesynchronizují se nikam (ani do mobilu) a neblokují
          rezervační sloty. Opakované události se rozbalí rok zpět a dva roky dopředu;
          pro novější data soubor nahraj znovu přes „Nahradit".
        </p>
      </div>

      {error && (
        <div className="glass rounded-xl p-3 text-sm text-[var(--destructive,#e5484d)]">{error}</div>
      )}
      {notice && (
        <div className="glass rounded-xl p-3 text-sm" style={{ ["--c" as string]: "var(--tint-sage)" }}>
          {notice}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".ics,text/calendar"
        multiple
        className="hidden"
        onChange={(e) => onFilesPicked(e.target.files)}
      />

      <div className="glass rounded-xl p-4 space-y-3">
        <div className="text-sm font-medium">Nový kalendář</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Název (volitelné — jinak podle souboru)"
            className="flex-1"
          />
          <Button onClick={() => pickFile(null)} disabled={uploading}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Nahrát .ics
          </Button>
        </div>
      </div>

      {calendars.length === 0 ? (
        <div className="glass rounded-xl p-6 text-sm text-muted-foreground flex items-center gap-2">
          <CalendarDays className="size-4" /> Zatím žádný nahraný kalendář.
        </div>
      ) : (
        <div className="space-y-2">
          {calendars.map((cal) => (
            <div key={cal.id} className="glass rounded-xl p-4 flex flex-wrap items-center gap-3">
              <CalendarDays className="size-4 text-[var(--tint-sage)] shrink-0" />
              <div className="flex-1 min-w-40">
                <div className="font-medium">{cal.name}</div>
                <div className="text-xs text-muted-foreground font-mono">
                  {cal.filename} · {cal.eventCount} událostí · aktualizováno{" "}
                  {new Date(cal.updatedAt).toLocaleDateString("cs-CZ")}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => pickFile(cal.id)} disabled={uploading} title="Nahradit obsah novým souborem">
                  <RefreshCw className="size-4" /> Nahradit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(cal)} title="Smazat kalendář i události">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
