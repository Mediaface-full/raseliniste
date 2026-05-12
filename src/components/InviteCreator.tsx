import { useState, useEffect } from "react";
import {
  Send, Copy, Check, Loader2, AlertTriangle, User, Globe, Trash2, ExternalLink,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Contact {
  id: string;
  displayName: string;
  isClient?: boolean;
  isFriend?: boolean;
}

interface InviteRow {
  id: string;
  token: string;
  mode: string;
  meetingType: string;
  slotDurationMin: number;
  status: string;
  validUntil: string;
  inviteeName: string | null;
  inviteeEmail: string | null;
  reservedSlot: { startsAt: string; endsAt: string; type: string } | null;
  contact: { id: string; displayName: string } | null;
  createdAt: string;
}

const APP_URL_BASE = typeof window !== "undefined" ? window.location.origin : "";

export default function InviteCreator() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactQuery, setContactQuery] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [universal, setUniversal] = useState(false);
  const [mode, setMode] = useState<"CLIENT" | "FRIEND">("CLIENT");
  const [meetingType, setMeetingType] = useState<"CHOICE_PRAGUE" | "CHOICE_ONLINE" | "CHOICE_HOME" | "CHOICE_ANY">("CHOICE_ANY");
  const [duration, setDuration] = useState("60");
  const [validity, setValidity] = useState("14");
  const [internalNote, setInternalNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [invites, setInvites] = useState<InviteRow[]>([]);

  useEffect(() => {
    void loadInvites();
  }, []);

  // Server-side search přes ?q= (hledá v displayName + firstName + lastName + phones).
  // Předchozí verze: fetch všech 500, client-side filter jen v displayName → propadlí
  // kontakti s prázdným/odlišným displayName (např. importováno bez FN).
  useEffect(() => {
    const q = contactQuery.trim();
    // Debounce 200ms, ať nepalí každý keystroke
    const timer = setTimeout(() => {
      void loadContacts(q);
    }, 200);
    return () => clearTimeout(timer);
  }, [contactQuery]);

  async function loadContacts(q: string) {
    const url = q ? `/api/contacts?q=${encodeURIComponent(q)}` : "/api/contacts";
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      setContacts(data.contacts ?? data);
    }
  }

  async function loadInvites() {
    const res = await fetch("/api/booking/invite");
    if (res.ok) {
      const data = await res.json();
      setInvites(data.invites);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    setCreatedUrl(null);
    try {
      const res = await fetch("/api/booking/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactId: universal ? null : selectedContactId,
          mode,
          meetingType,
          slotDurationMin: parseInt(duration),
          validityDays: parseInt(validity),
          internalNote: internalNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Vytvoření selhalo.");
        return;
      }
      setCreatedUrl(data.url);
      void loadInvites();
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function cancel(inviteId: string) {
    if (!confirm("Opravdu zrušit tuto pozvánku?")) return;
    const res = await fetch(`/api/booking/${inviteId}/cancel`, { method: "POST" });
    if (res.ok) void loadInvites();
  }

  // Search už dělá server přes ?q= — tady jen vezmeme prvních 20 z response.
  const filteredContacts = contacts.slice(0, 20);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl">Pozvánka na schůzku</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Vygeneruj link pro klienta nebo přítele. Klient si vybere slot, potvrdíš mailem, vznikne event v Google.
        </p>
      </div>

      <div className="glass rounded-xl p-5 space-y-4" style={{ ["--c" as string]: "var(--tint-sky)" }}>
        <h2 className="font-serif text-lg">Nová pozvánka</h2>

        {/* Personalizovaný vs univerzální */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setUniversal(false)}
            className={`rounded-lg border p-3 text-left transition ${!universal ? "border-[var(--tint-sky)] bg-[var(--tint-sky)]/10" : "border-white/10 hover:bg-white/5"}`}
          >
            <div className="flex items-center gap-2 mb-1"><User className="size-4" /> <strong>Konkrétní osoba</strong></div>
            <div className="text-xs text-muted-foreground">Z kontaktů. Nemusí nic vyplňovat.</div>
          </button>
          <button
            type="button"
            onClick={() => setUniversal(true)}
            className={`rounded-lg border p-3 text-left transition ${universal ? "border-[var(--tint-mint)] bg-[var(--tint-mint)]/10" : "border-white/10 hover:bg-white/5"}`}
          >
            <div className="flex items-center gap-2 mb-1"><Globe className="size-4" /> <strong>Univerzální link</strong></div>
            <div className="text-xs text-muted-foreground">Pošleš komukoliv. Vyplní jméno + e-mail.</div>
          </button>
        </div>

        {!universal && (
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">Kontakt</label>
            <Input
              placeholder="Hledej kontakt…"
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
            />
            <div className="mt-2 max-h-40 overflow-y-auto border border-white/5 rounded-md">
              {filteredContacts.slice(0, 10).map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedContactId(c.id); setContactQuery(c.displayName); }}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-white/5 last:border-0 hover:bg-white/5 ${selectedContactId === c.id ? "bg-[var(--tint-sky)]/10" : ""}`}
                >
                  {c.displayName}
                </button>
              ))}
              {filteredContacts.length === 0 && (
                <div className="px-3 py-3 text-xs text-muted-foreground italic">Žádné kontakty.</div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">Vztah</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "CLIENT" | "FRIEND")}
              className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
            >
              <option value="CLIENT">Klient (lead time 48 h)</option>
              <option value="FRIEND">Přítel (lead time 12 h)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">Typ schůzky</label>
            <select
              value={meetingType}
              onChange={(e) => setMeetingType(e.target.value as typeof meetingType)}
              className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
            >
              <option value="CHOICE_ANY">Libovolně (Praha / online / doma)</option>
              <option value="CHOICE_PRAGUE">Jen Praha</option>
              <option value="CHOICE_ONLINE">Jen online</option>
              <option value="CHOICE_HOME">Jen u mě doma</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">Délka</label>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
            >
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">60 min</option>
              <option value="90">90 min</option>
              <option value="120">2 hodiny</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">Platnost (dní)</label>
            <select
              value={validity}
              onChange={(e) => setValidity(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
            >
              <option value="7">7 dní</option>
              <option value="14">14 dní</option>
              <option value="30">30 dní</option>
              <option value="90">90 dní</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs font-mono uppercase text-muted-foreground">Interní poznámka (volitelně, jen pro tebe)</label>
          <Input value={internalNote} onChange={(e) => setInternalNote(e.target.value)} placeholder="O čem to bude…" />
        </div>

        <Button onClick={create} disabled={busy || (!universal && !selectedContactId)}>
          {busy ? <><Loader2 className="animate-spin" /> Vytvářím…</> : <><Send /> Vygenerovat link</>}
        </Button>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {createdUrl && (
          <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 p-3 space-y-2">
            <div className="text-sm flex items-center gap-2"><Check className="size-4 text-[var(--tint-sage)]" /> <strong>Link vytvořen</strong></div>
            <div className="font-mono text-xs break-all bg-black/30 p-2 rounded border border-white/5">
              {createdUrl}
            </div>
            <Button size="sm" variant="outline" onClick={() => copy(createdUrl)}>
              {copied ? <><Check /> Zkopírováno</> : <><Copy /> Kopírovat</>}
            </Button>
          </div>
        )}
      </div>

      {/* Existující pozvánky */}
      <div className="glass rounded-xl p-5">
        <h2 className="font-serif text-lg mb-3">Vytvořené pozvánky ({invites.length})</h2>
        {invites.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">Žádné pozvánky.</div>
        ) : (
          <div className="space-y-2">
            {invites.map((inv) => {
              const url = `${APP_URL_BASE}/i/${inv.token}`;
              const isUniversal = !inv.contact && !inv.inviteeName;
              return (
                <div key={inv.id} className="rounded-md border border-white/5 bg-black/15 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status={inv.status} />
                    <span className="text-sm font-medium">
                      {inv.contact?.displayName ?? inv.inviteeName ?? (isUniversal ? "Univerzální link" : "—")}
                    </span>
                    <span className="ml-auto text-xs font-mono text-muted-foreground">
                      {inv.slotDurationMin} min · {inv.mode === "CLIENT" ? "klient" : "přítel"} · {meetingTypeLabel(inv.meetingType)}
                    </span>
                  </div>
                  {inv.reservedSlot && (
                    <div className="text-xs text-[var(--tint-butter)] mb-1">
                      🕐 {new Date(inv.reservedSlot.startsAt).toLocaleString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => copy(url)} className="text-xs font-mono text-muted-foreground hover:text-foreground flex items-center gap-1">
                      <Copy className="size-3" /> Kopírovat link
                    </button>
                    <a href={url} target="_blank" rel="noreferrer" className="text-xs font-mono text-muted-foreground hover:text-foreground flex items-center gap-1">
                      <ExternalLink className="size-3" /> Otevřít
                    </a>
                    {inv.status !== "CANCELED" && inv.status !== "EXPIRED" && (
                      <button onClick={() => cancel(inv.id)} className="ml-auto text-xs text-destructive hover:underline flex items-center gap-1">
                        <Trash2 className="size-3" /> Zrušit
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    PENDING: { label: "čeká", color: "var(--tint-sky)" },
    VIEWED: { label: "otevřeno", color: "var(--tint-lavender)" },
    RESERVED: { label: "rezervováno", color: "var(--tint-butter)" },
    CONFIRMED: { label: "potvrzeno", color: "var(--tint-sage)" },
    CANCELED: { label: "zrušeno", color: "var(--muted-foreground)" },
    EXPIRED: { label: "expirováno", color: "var(--muted-foreground)" },
  };
  const item = map[status] ?? { label: status, color: "var(--muted-foreground)" };
  return (
    <span
      className="text-[10px] uppercase font-mono tracking-wider px-2 py-0.5 rounded"
      style={{ background: `color-mix(in oklch, ${item.color} 18%, transparent)`, color: item.color }}
    >
      {item.label}
    </span>
  );
}

function meetingTypeLabel(t: string): string {
  switch (t) {
    case "CHOICE_PRAGUE": return "Praha";
    case "CHOICE_ONLINE": return "online";
    case "CHOICE_HOME": return "doma";
    case "CHOICE_ANY": return "libovolně";
    default: return t;
  }
}
