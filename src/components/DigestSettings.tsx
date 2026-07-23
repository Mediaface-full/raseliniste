import { useEffect, useState } from "react";
import { ChevronRight, ChevronDown, Loader2, Check, Eye } from "lucide-react";
import { Button } from "./ui/Button";

/**
 * Nastavení denního digestu pro kolegyni (ADHD F4). Sbalený řádek na
 * /planovani: výběr týmového kontaktu + zapnutí + náhled dnešního obsahu.
 * Odesílá se každý pracovní den v 7:00 e-mailem (cron kolegyne-digest).
 */

interface TeamContact { id: string; name: string; email: string | null }

export default function DigestSettings() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [contactId, setContactId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<TeamContact[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    fetch("/api/planovani/digest")
      .then((r) => r.json())
      .then((d) => {
        setEnabled(d.enabled ?? false);
        setContactId(d.contactId ?? null);
        setContacts(d.teamContacts ?? []);
        setLoaded(true);
      })
      .catch(() => setError("Načtení nastavení selhalo."));
  }, [open, loaded]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/planovani/digest", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, contactId }),
      });
      if (!res.ok) { setError("Uložení se nepovedlo."); return; }
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function loadPreview() {
    setPreviewBusy(true);
    setPreview(null);
    setError(null);
    try {
      const res = await fetch("/api/planovani/digest?nahled=1");
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Náhled selhal."); return; }
      setPreview(`${d.subject}\n\n${d.text}`);
    } finally {
      setPreviewBusy(false);
    }
  }

  const selected = contacts.find((c) => c.id === contactId);

  return (
    <div className="glass-subtle rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left"
      >
        {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        <span className="font-medium">Digest pro kolegyni</span>
        <span className="text-xs text-muted-foreground">
          — každý pracovní den v 7:00 e-mail: co dnes/zítra dělám a co připravit
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {!loaded && !error ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <select
                  value={contactId ?? ""}
                  onChange={(e) => { setContactId(e.target.value || null); setSaved(false); }}
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                >
                  <option value="">— vyber týmový kontakt —</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.email}>
                      {c.name}{c.email ? ` (${c.email})` : " — bez e-mailu"}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }}
                  />
                  posílat denně
                </label>
                <Button onClick={save} disabled={saving || (enabled && !contactId)} size="sm">
                  {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
                  Uložit
                </Button>
                <Button onClick={loadPreview} disabled={previewBusy || !contactId} variant="ghost" size="sm">
                  {previewBusy ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                  Náhled
                </Button>
              </div>
              {selected && !selected.email && (
                <div className="text-xs text-[color:var(--c-signal)]">Vybraný kontakt nemá e-mail — doplň ho v Kontaktech.</div>
              )}
              {error && <div className="text-sm text-[var(--destructive,#e5484d)]">{error}</div>}
              {preview && (
                <pre className="rounded-md bg-black/20 p-3 text-xs whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">{preview}</pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
