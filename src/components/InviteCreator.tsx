import { useState, useEffect } from "react";
import {
  Send, Copy, Check, Loader2, AlertTriangle, User, Globe, Trash2, ExternalLink, Mail,
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
  // Petr 2026-05-25: per-invite "sloty dostupné od" — YYYY-MM-DD string.
  // Prázdné = jen globální lead time (72h klient / 24h přítel).
  const [availableFrom, setAvailableFrom] = useState("");
  // Petr 2026-05-25: veřejná poznámka pro hosta. Zobrazí se v pickeru,
  // v Google eventu (description) a v .ics mailové příloze.
  const [publicNote, setPublicNote] = useState("");
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
          availableFrom: availableFrom.trim() || undefined,
          publicNote: publicNote.trim() || undefined,
        }),
      });
      const text = await res.text();
      let data: { error?: string; url?: string; invite?: { id: string } } | null = null;
      try { data = JSON.parse(text); } catch { /* not json */ }
      if (!res.ok || !data?.url) {
        // Petr 2026-05-27: nezahodit chybu tichu. Detailní text + console.error,
        // aby Petr přehlédnutý error mohl dohledat.
        const detail = data?.error ?? text?.slice(0, 400) ?? `HTTP ${res.status}`;
        setError(detail);
        console.error("[booking.invite] create failed", res.status, data ?? text);
        return;
      }
      setCreatedUrl(data.url);
      void loadInvites();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Síťová chyba: ${msg}`);
      console.error("[booking.invite] network error", e);
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

  // Petr 2026-05-21: znovu odeslat potvrzovací mail. Použít pokud kontakt
  // neměl email v Contacts při create — Petr ho mezi tím doplnil, klikne
  // "Poslat znovu" → backend sáhne pro aktuální Contact.emails[0] nebo
  // si Petr v dialogu zadá email ručně.
  // Petr 2026-06-10: diagnostika proč mail nedorazil. Volá existující
  // /api/booking/:id/diagnose endpoint a vypíše čistý summary.
  async function diagnoseInvite(inviteId: string) {
    try {
      const res = await fetch(`/api/booking/${inviteId}/diagnose`);
      const data = await res.json();
      if (!res.ok) {
        alert(`Diagnostika selhala: ${data.error ?? `HTTP ${res.status}`}`);
        return;
      }
      const lines: string[] = [];
      lines.push(`Stav pozvánky: ${data.summary?.status ?? "?"}`);
      lines.push(`E-mail hosta: ${data.summary?.inviteeEmail ?? "(žádný)"}`);
      if (data.summary?.confirmedAt) {
        lines.push(`Potvrzeno: ${new Date(data.summary.confirmedAt).toLocaleString("cs-CZ")}`);
      }
      lines.push("");
      lines.push("Verdikt:");
      const verdict = Array.isArray(data.verdict) ? data.verdict : [data.verdict].filter(Boolean);
      verdict.forEach((v: string) => lines.push(`  ${v}`));
      lines.push("");
      const mailLogs = Array.isArray(data.mailLogs) ? data.mailLogs : [];
      if (mailLogs.length === 0) {
        lines.push("Mail log: žádný záznam (mail nikdy nešel)");
      } else {
        lines.push(`Mail log (${mailLogs.length} záznamů):`);
        mailLogs.slice(0, 5).forEach((l: { ok: boolean; context?: string; provider?: string; error?: string; createdAt?: string }) => {
          const time = l.createdAt ? new Date(l.createdAt).toLocaleString("cs-CZ") : "?";
          lines.push(`  ${l.ok ? "" : ""} ${time} · ${l.context ?? ""}${l.error ? ` · ${l.error}` : ""}`);
        });
      }
      alert(lines.join("\n"));
    } catch (e) {
      alert(`Diagnostika selhala: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function resend(inviteId: string, existingEmail: string | null) {
    let override: string | null = null;
    if (!existingEmail) {
      const input = prompt(
        "Pozvánka nemá v DB email. Zadej email pro odeslání:",
        "",
      );
      if (!input?.trim()) return;
      override = input.trim();
    } else {
      if (!confirm(`Poslat potvrzovací mail znovu na ${existingEmail}?`)) return;
    }
    const res = await fetch(`/api/booking/${inviteId}/resend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(override ? { email: override } : {}),
    });
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* ignore */ }
    if (!res.ok || !data?.ok) {
      const detail = data?.error ?? text?.slice(0, 300) ?? `HTTP ${res.status}`;
      alert(`Odeslání selhalo (${res.status}):\n\n${detail}`);
      console.error("[booking.resend] fail", res.status, data ?? text);
      return;
    }
    alert(`Mail odeslán na ${data.sentTo} (${data.provider}${data.providerId ? ` · ${data.providerId}` : ""})`);
    void loadInvites();
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
          <label className="text-xs font-mono uppercase text-muted-foreground">
            Sloty dostupné od (volitelně)
          </label>
          <input
            type="date"
            value={availableFrom}
            onChange={(e) => setAvailableFrom(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Host nedostane sloty před tímto datem. Prázdné = jen globální lead time
            ({mode === "CLIENT" ? "72 h klient" : "24 h přítel"}).
          </p>
        </div>

        <div>
          <label className="text-xs font-mono uppercase text-muted-foreground">
            Poznámka pro hosta (volitelně)
          </label>
          <textarea
            value={publicNote}
            onChange={(e) => setPublicNote(e.target.value)}
            placeholder='Třeba: „Přines prosím podklady, které jsme řešili minule." nebo „Mám připravenou ukázku."'
            rows={3}
            className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm leading-relaxed resize-y min-h-[72px]"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Uvidí ji host v rezervační stránce, v Google kalendářovém eventu a v .ics příloze mailu.
          </p>
        </div>

        <div>
          <label className="text-xs font-mono uppercase text-muted-foreground">Interní poznámka (volitelně, jen pro tebe)</label>
          <Input value={internalNote} onChange={(e) => setInternalNote(e.target.value)} placeholder="O čem to bude…" />
        </div>

        <Button onClick={create} disabled={busy || (!universal && !selectedContactId)}>
          {busy ? <><Loader2 className="animate-spin" /> Vytvářím…</> : <><Send /> Vygenerovat link</>}
        </Button>

        {error && (
          <div
            className="rounded-lg border-2 border-destructive/60 bg-destructive/15 text-base px-4 py-3 flex items-start gap-3"
            role="alert"
            ref={(el) => { if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}
          >
            <AlertTriangle className="size-5 shrink-0 mt-0.5 text-destructive" />
            <div className="flex-1">
              <div className="font-semibold text-destructive">Vytvoření pozvánky selhalo</div>
              <div className="mt-1 leading-relaxed">{error}</div>
              {error.toLowerCase().includes("email") && (
                <div className="mt-2 text-sm">
                  <a href="/contacts/tabulka" className="underline text-[var(--tint-sky)]">
                    → Otevřít kontakty a doplnit email
                  </a>
                </div>
              )}
            </div>
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
            {/* Petr 2026-05-27 #22: mobile-friendly karty — větší touch
                targets, info zalomené pod sebe, akce v gridu s text-sm. */}
            {invites.map((inv) => {
              const url = `${APP_URL_BASE}/i/${inv.token}`;
              const isUniversal = !inv.contact && !inv.inviteeName;
              const isActive = inv.status !== "CANCELED" && inv.status !== "EXPIRED";
              const canResend = inv.status === "CONFIRMED" || inv.status === "RESERVED";
              return (
                <div key={inv.id} className="rounded-lg border border-white/10 bg-black/15 p-4">
                  {/* Header: jméno + status (zalomené na mobilu) */}
                  <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusBadge status={inv.status} />
                      <span className="text-base font-medium truncate">
                        {inv.contact?.displayName ?? inv.inviteeName ?? (isUniversal ? "Univerzální link" : "—")}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {inv.slotDurationMin} min · {inv.mode === "CLIENT" ? "klient" : "přítel"}
                    </span>
                  </div>

                  {/* Typ schůzky + rezervovaný slot */}
                  <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2 flex-wrap">
                    <span>{meetingTypeLabel(inv.meetingType)}</span>
                    {inv.reservedSlot && (
                      <span className="text-[var(--tint-butter)]">
                        · 🕐 {new Date(inv.reservedSlot.startsAt).toLocaleString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>

                  {/* Akce — 2-sloupcový grid na mobilu, řádkový na desktopu */}
                  <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                    <button
                      onClick={() => copy(url)}
                      className="flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 text-foreground"
                    >
                      <Copy className="size-4" /> Kopírovat
                    </button>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 text-foreground"
                    >
                      <ExternalLink className="size-4" /> Otevřít
                    </a>
                    {canResend && (
                      <button
                        onClick={() => resend(inv.id, inv.inviteeEmail ?? null)}
                        className="flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-[var(--tint-sky)]/15 hover:bg-[var(--tint-sky)]/25 text-[var(--tint-sky)] sm:ml-auto"
                        title={inv.inviteeEmail ? `Poslat na ${inv.inviteeEmail}` : "Pozvánka nemá email — zadáš ho v dialogu"}
                      >
                        <Mail className="size-4" /> Poslat mail
                      </button>
                    )}
                    {/* Petr 2026-06-10: Diagnostika — proč mail nedorazil */}
                    <button
                      onClick={() => diagnoseInvite(inv.id)}
                      className="flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 text-muted-foreground"
                      title="Proč mail nedorazil? Stav invite + mail log + verdict"
                    >
                      Diagnostika
                    </button>
                    {isActive && (
                      <button
                        onClick={() => cancel(inv.id)}
                        className="flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-destructive/15 hover:bg-destructive/25 text-[var(--tint-rose)]"
                      >
                        <Trash2 className="size-4" /> Zrušit
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
