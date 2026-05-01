import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Save, X, Calendar, Bell, Mail, MessageCircle } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Anniversary {
  id: string;
  title: string;
  month: number;
  day: number;
  year: number | null;
  note: string | null;
  reminderDaysBefore: number | null;
  reminderChannels: string[];
}

const REMINDER_OPTIONS = [
  { value: -1, label: "Bez upozornění" },
  { value: 0, label: "V den výročí" },
  { value: 1, label: "1 den předem" },
  { value: 3, label: "3 dny předem" },
  { value: 7, label: "Týden předem" },
  { value: 14, label: "2 týdny předem" },
  { value: 30, label: "Měsíc předem" },
];

export default function AnniversaryManager() {
  const [items, setItems] = useState<Anniversary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Anniversary | "new" | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vyroci");
      const data = await res.json();
      if (res.ok) setItems(data.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function remove(item: Anniversary) {
    if (!confirm(`Smazat „${item.title}"?`)) return;
    const res = await fetch(`/api/vyroci/${item.id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  if (loading) {
    return (
      <div className="glass rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Načítám…
      </div>
    );
  }

  // Spočítej "kolikáté výročí" pro letošek (pokud je rok zadán)
  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl p-3 flex items-center gap-2">
        <div className="text-sm text-muted-foreground flex-1">
          {items.length} výroč{items.length === 1 ? "í" : items.length < 5 ? "í" : "í"}
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus /> Nové výročí
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center text-muted-foreground">
          Zatím žádné výročí. Přidej první klikem na <strong>Nové výročí</strong>.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((it) => {
            const yearsThis = it.year ? currentYear - it.year : null;
            const dateStr = `${it.day}.${it.month}.${it.year ?? ""}`;
            return (
              <div
                key={it.id}
                className="glass rounded-xl p-4 flex flex-col gap-2"
                style={{ ["--c" as string]: "var(--tint-rose)" }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="size-10 rounded-md grid place-items-center shrink-0"
                    style={{
                      background: "color-mix(in oklch, var(--c) 18%, transparent)",
                      color: "var(--c)",
                    }}
                  >
                    <Calendar className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">
                      {yearsThis && yearsThis > 0 ? `${yearsThis}. ` : ""}
                      {it.title}
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">
                      {dateStr}
                    </div>
                    {it.note && (
                      <div className="text-xs text-muted-foreground/80 mt-1 line-clamp-2">{it.note}</div>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-[11px] font-mono">
                      {it.reminderDaysBefore !== null ? (
                        <span className="flex items-center gap-1 text-[var(--tint-sage)]">
                          <Bell className="size-3" />
                          {it.reminderDaysBefore === 0 ? "v den" : `${it.reminderDaysBefore} dní předem`}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">bez upozornění</span>
                      )}
                      {it.reminderChannels.includes("email") && (
                        <span className="flex items-center gap-1 text-[var(--tint-sky)]">
                          <Mail className="size-3" /> mail
                        </span>
                      )}
                      {it.reminderChannels.includes("whatsapp") && (
                        <span className="flex items-center gap-1 text-[var(--tint-mint)]">
                          <MessageCircle className="size-3" /> WhatsApp
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => setEditing(it)}
                      className="p-1.5 rounded hover:bg-white/5 text-xs text-muted-foreground"
                    >
                      Upravit
                    </button>
                    <button
                      onClick={() => remove(it)}
                      className="p-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <Editor
          item={editing === "new" ? null : editing}
          onClose={(reload) => {
            setEditing(null);
            if (reload) load();
          }}
        />
      )}
    </div>
  );
}

function Editor({ item, onClose }: { item: Anniversary | null; onClose: (r: boolean) => void }) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [day, setDay] = useState(item?.day?.toString() ?? "");
  const [month, setMonth] = useState(item?.month?.toString() ?? "");
  const [year, setYear] = useState(item?.year?.toString() ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [reminderDays, setReminderDays] = useState<number>(item?.reminderDaysBefore ?? -1);
  const [emailCh, setEmailCh] = useState((item?.reminderChannels ?? []).includes("email"));
  const [whatsappCh, setWhatsappCh] = useState((item?.reminderChannels ?? []).includes("whatsapp"));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = year.trim() ? parseInt(year, 10) : null;
    if (!title.trim() || !Number.isFinite(d) || !Number.isFinite(m)) {
      setErr("Vyplň název, den a měsíc.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const channels: string[] = [];
      if (emailCh) channels.push("email");
      if (whatsappCh) channels.push("whatsapp");
      const payload = {
        title: title.trim(),
        day: d,
        month: m,
        year: y && Number.isFinite(y) ? y : null,
        note: note.trim() || null,
        reminderDaysBefore: reminderDays >= 0 ? reminderDays : null,
        reminderChannels: channels,
      };
      const res = item
        ? await fetch(`/api/vyroci/${item.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/vyroci", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Uložení selhalo.");
        return;
      }
      onClose(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={() => onClose(false)}>
      <div
        className="glass-strong rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg">{item ? "Upravit výročí" : "Nové výročí"}</h3>
          <button onClick={() => onClose(false)} className="p-1 hover:bg-white/5 rounded">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Název</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Výročí svatby / Babička † / První rande s X"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Den</label>
              <Input type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} className="text-center font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Měsíc</label>
              <Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(e.target.value)} className="text-center font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Rok (nepovinné)</label>
              <Input type="number" min={1900} max={2100} value={year} onChange={(e) => setYear(e.target.value)} placeholder="2010" className="text-center font-mono" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-2">
            Když vyplníš rok, dashboard ukáže „N. výročí" (např. „16. Výročí svatby"). Bez roku jen název + datum.
          </p>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Poznámka (volitelné)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm resize-none"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              Upozornění předem
            </label>
            <select
              value={reminderDays}
              onChange={(e) => setReminderDays(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2.5 rounded-md bg-background/40 border border-border/60 text-base"
            >
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {reminderDays >= 0 && (
            <div className="space-y-1.5 pl-2 border-l-2 border-[var(--tint-rose)]/30">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block">
                Kanály upozornění
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={emailCh} onChange={(e) => setEmailCh(e.target.checked)} className="size-4" />
                <Mail className="size-4 text-[var(--tint-sky)]" /> Email
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm opacity-60">
                <input type="checkbox" checked={whatsappCh} onChange={(e) => setWhatsappCh(e.target.checked)} className="size-4" />
                <MessageCircle className="size-4 text-[var(--tint-mint)]" /> WhatsApp
                <span className="text-[10px] font-mono text-muted-foreground">(brzy — vybíráš službu)</span>
              </label>
            </div>
          )}
        </div>

        {err && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{err}</div>}

        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Save /> Uložit</>}
          </Button>
          <Button variant="ghost" onClick={() => onClose(false)}>Zrušit</Button>
        </div>
      </div>
    </div>
  );
}
