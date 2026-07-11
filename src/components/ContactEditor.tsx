/**
 * ContactEditor — modal pro úpravu/založení kontaktu.
 *
 * Extracted z ContactsManager.tsx (Petr 2026-06-19 — sjednocení na jeden
 * Kontakty UI: /contacts/tabulka jako single source, ContactsManager pryč).
 * ContactEditor zůstává jako shared modal pro „Upravit kontakt" v tabulce.
 *
 * Plné fields:
 *   - Display name + firstName/lastName
 *   - firstNameVocative (5. pád) + greetingOverride (vlastní VIP oslovení)
 *   - VIP / Team flags
 *   - todoistUserId (responsible_uid)
 *   - clientTag + aliases + clientTagAliases (pro AI fuzzy match)
 *   - Phones + Emails (multi)
 *   - Birthday + reminder days/channels
 *   - callLogToken (generuje URL /call-log?t=)
 */
import { useEffect, useState } from "react";
import { Loader2, Save, X, Star, Mail, MessageCircle, Link as LinkIcon } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

export interface Contact {
  id: string;
  displayName: string;
  firstName: string | null;
  firstNameVocative: string | null;
  greetingOverride: string | null;
  lastName: string | null;
  note: string | null;
  isVip: boolean;
  isTeam: boolean;
  todoistUserId: string | null;
  defaultMeetLink: string | null;
  clientTag: string | null;
  aliases: string[];
  clientTagAliases: string[];
  callLogToken: string | null;
  callLogTokenCreatedAt: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  birthdayReminderDaysBefore: number | null;
  birthdayReminderChannels: string[];
  importedFrom: string | null;
  phones: { id: string; number: string; label: string | null }[];
  emails: { id: string; email: string; label: string | null }[];
  _count?: { callLogs: number };
}

interface EditorProps {
  contact: Contact | null;
  onClose: (reload: boolean) => void;
}

export function ContactEditor({ contact, onClose }: EditorProps) {
  const [displayName, setDisplayName] = useState(contact?.displayName ?? "");
  const [firstName, setFirstName] = useState(contact?.firstName ?? "");
  const [firstNameVocative, setFirstNameVocative] = useState(contact?.firstNameVocative ?? "");
  const [greetingOverride, setGreetingOverride] = useState(contact?.greetingOverride ?? "");
  const [lastName, setLastName] = useState(contact?.lastName ?? "");
  const [note, setNote] = useState(contact?.note ?? "");
  const [isVip, setIsVip] = useState(contact?.isVip ?? false);
  const [isTeam, setIsTeam] = useState(contact?.isTeam ?? false);
  const [todoistUserId, setTodoistUserId] = useState(contact?.todoistUserId ?? "");
  const [defaultMeetLink, setDefaultMeetLink] = useState(contact?.defaultMeetLink ?? "");
  const [clientTag, setClientTag] = useState(contact?.clientTag ?? "");
  // Aliases — input je čárkou oddělený řetězec, parsujeme při uložení.
  // Display chip list pod inputem ukazuje aktuálně uložené hodnoty.
  const [aliasesInput, setAliasesInput] = useState((contact?.aliases ?? []).join(", "));
  const [clientTagAliasesInput, setClientTagAliasesInput] = useState((contact?.clientTagAliases ?? []).join(", "));
  const [birthDay, setBirthDay] = useState(contact?.birthDay?.toString() ?? "");
  const [birthMonth, setBirthMonth] = useState(contact?.birthMonth?.toString() ?? "");
  const [bdayRemind, setBdayRemind] = useState<number>(
    contact?.birthdayReminderDaysBefore ?? -1,
  );
  const [bdayChEmail, setBdayChEmail] = useState((contact?.birthdayReminderChannels ?? []).includes("email"));
  const [bdayChWhats, setBdayChWhats] = useState((contact?.birthdayReminderChannels ?? []).includes("whatsapp"));
  const [phones, setPhones] = useState(
    contact?.phones.map((p) => ({ number: p.number, label: p.label ?? "" })) ?? [{ number: "", label: "mobile" }]
  );
  const [emails, setEmails] = useState(
    contact?.emails.map((e) => ({ email: e.email, label: e.label ?? "" })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaving(true);
    const bd = parseInt(birthDay, 10);
    const bm = parseInt(birthMonth, 10);
    const payload = {
      displayName: displayName.trim() || [firstName, lastName].filter(Boolean).join(" ") || "(bez jména)",
      firstName: firstName.trim() || null,
      firstNameVocative: firstNameVocative.trim() || null,
      greetingOverride: greetingOverride.trim() || null,
      lastName: lastName.trim() || null,
      note: note.trim() || null,
      isVip,
      isTeam,
      todoistUserId: todoistUserId.trim() || null,
      defaultMeetLink: defaultMeetLink.trim() || null,
      // clientTag — povolíme jen lowercase + pomlčky bez diakritiky (server to taky validuje).
      clientTag: clientTag.trim() ? clientTag.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || null : null,
      // Parse comma-separated aliases — server pak trim+lowercase+dedup
      aliases: aliasesInput.split(",").map((s) => s.trim()).filter((s) => s.length > 0),
      clientTagAliases: clientTagAliasesInput.split(",").map((s) => s.trim()).filter((s) => s.length > 0),
      birthDay: Number.isFinite(bd) && bd >= 1 && bd <= 31 ? bd : null,
      birthMonth: Number.isFinite(bm) && bm >= 1 && bm <= 12 ? bm : null,
      birthdayReminderDaysBefore: bdayRemind >= 0 ? bdayRemind : null,
      birthdayReminderChannels: [
        ...(bdayChEmail ? ["email"] : []),
        ...(bdayChWhats ? ["whatsapp"] : []),
      ],
      phones: phones.filter((p) => p.number.trim()).map((p) => ({
        number: p.number.trim(),
        label: p.label || null,
      })),
      emails: emails.filter((e) => e.email.trim()).map((e) => ({
        email: e.email.trim(),
        label: e.label || null,
      })),
    };
    try {
      const res = contact
        ? await fetch(`/api/contacts/${contact.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/contacts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Uložení selhalo.");
        return;
      }
      onClose(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div
        className="modal-panel max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg">{contact ? "Upravit kontakt" : "Nový kontakt"}</h3>
          <button onClick={() => onClose(false)} className="p-1 hover:bg-white/5 rounded">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Celé jméno (zobrazované)</label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Jméno</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Příjmení</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              Oslovení (5. pád) — jen VIP
            </label>
            <Input
              value={firstNameVocative}
              onChange={(e) => setFirstNameVocative(e.target.value)}
              placeholder={firstName ? `např. „${firstName.endsWith("a") ? firstName.slice(0, -1) + "o" : firstName + "e"}"` : ""}
            />
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
              Pokud necháš prázdné, systém zkusí odhadnout. Vyplň jen u jmen co algoritmus zkazí.
            </p>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-[var(--tint-rose)] font-mono">
              Vlastní oslovení — jen VIP (volitelné)
            </label>
            <Input
              value={greetingOverride}
              onChange={(e) => setGreetingOverride(e.target.value)}
              placeholder='např. „Drahá dívko" nebo „Šéfe" nebo „Kamaráde"'
            />
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
              Když vyplníš, na /call-log VIP nahradí defaultní „Ahoj, {firstNameVocative || firstName || "Jméno"}". Celý styl je tvůj.
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer py-1">
            <input type="checkbox" checked={isVip} onChange={(e) => setIsVip(e.target.checked)} className="size-4" />
            <Star className="size-4" style={{ color: "var(--tint-rose)" }} fill={isVip ? "currentColor" : "none"} />
            <span className="text-sm">VIP — firewall → zvláštní projekt + okamžitý email</span>
          </label>

          {contact?.isVip && contact?.id && (
            <VipLinkSection contactId={contact.id} initialToken={contact.callLogToken} />
          )}

          {/* Smart routing — Tým + Klient */}
          <div className="rounded-md p-3 space-y-2.5"
            style={{
              background: "color-mix(in oklch, var(--tint-mint) 5%, transparent)",
              border: "1px solid color-mix(in oklch, var(--tint-mint) 20%, transparent)",
            }}
          >
            <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
              Routing úkolů do Todoistu
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isTeam} onChange={(e) => setIsTeam(e.target.checked)} className="size-4" />
              <span className="text-sm">
                <strong>Tým</strong> — úkoly delegované této osobě → projekt „Práce" / sekce <em>{firstName || "(jméno)"}</em>
              </span>
            </label>
            {isTeam && (
              <div className="pl-6">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-1">
                  Todoist user ID (volitelně) — pro reálné přiřazení v Todoistu
                </label>
                <Input
                  value={todoistUserId}
                  onChange={(e) => setTodoistUserId(e.target.value)}
                  placeholder="např. 12345678"
                />
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                  Bez tohoto: úkol skončí v sekci s jejím jménem, ale je asignovaný tobě. S vyplněným ID se asignuje
                  reálně a dostane notifikaci. ID si zjistíš na{" "}
                  <a href="/api/integrations/todoist/collaborators" target="_blank" className="underline text-[var(--tint-sky)]">
                    /api/integrations/todoist/collaborators
                  </a>
                  {" "}— vrátí všechny členy Workspace.
                </p>
              </div>
            )}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-1">
                Klient slug (volitelně) — např. <code>tk-stavby</code>
              </label>
              <Input
                value={clientTag}
                onChange={(e) => setClientTag(e.target.value)}
                placeholder="prázdné = běžný kontakt v projektu Lidé"
              />
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                Pokud má kontakt slug, úkoly delegované jemu i úkoly s tagem <code>klient-{clientTag || "<slug>"}</code> půjdou do projektu „Práce" / sekce „{clientTag ? clientTag.split("-").map(w => w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)).join(" ") : "<klient>"}".
              </p>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-1">
                Výchozí Meet link (volitelně)
              </label>
              <Input
                value={defaultMeetLink}
                onChange={(e) => setDefaultMeetLink(e.target.value)}
                placeholder="https://meet.google.com/abc-defg-hij"
              />
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                Trvalá Meet místnost tohoto kontaktu. Když potvrdí online schůzku
                z booking pozvánky, použije se tenhle link místo generování nového —
                přijde mu v potvrzovacím mailu i v kalendářové události.
              </p>
            </div>

            <AliasField
              label="Aliases (čárkou oddělené)"
              hint={`Jak v audiu kontakt nazývám — AI fuzzy match přes všechny synonyma. Např. "TK", "Tékáčko", "Karel z TK".`}
              value={aliasesInput}
              onChange={setAliasesInput}
              tint="lavender"
            />

            <AliasField
              label="Aliasy pro clientTag (čárkou oddělené)"
              hint={`Synonyma pro klienta. Např. clientTag "tk-stavby" + aliasy "TK", "TK Stavby", "Tékáčko". AI v audiu rozpozná a generuje kanonický klient-tk-stavby tag.`}
              value={clientTagAliasesInput}
              onChange={setClientTagAliasesInput}
              tint="sky"
              disabled={!clientTag.trim()}
              disabledReason="Nejdřív vyplň Klient slug výše"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              Narozeniny (den / měsíc — rok není potřeba)
            </label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                max={31}
                placeholder="den"
                value={birthDay}
                onChange={(e) => setBirthDay(e.target.value)}
                className="w-20 font-mono text-center"
              />
              <span className="self-center text-muted-foreground">.</span>
              <Input
                type="number"
                min={1}
                max={12}
                placeholder="měsíc"
                value={birthMonth}
                onChange={(e) => setBirthMonth(e.target.value)}
                className="w-20 font-mono text-center"
              />
              <span className="self-center text-xs text-muted-foreground">
                {birthDay && birthMonth ? `(${birthDay}.${birthMonth}.)` : ""}
              </span>
            </div>
            {birthDay && birthMonth && (
              <div className="mt-2 space-y-1.5">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block">
                  Upozornění na narozeniny
                </label>
                <select
                  value={bdayRemind}
                  onChange={(e) => setBdayRemind(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm"
                >
                  <option value={-1}>Bez upozornění</option>
                  <option value={0}>V den narozenin (jen popřát)</option>
                  <option value={3}>3 dny předem</option>
                  <option value={7}>Týden předem (čas na dárek)</option>
                  <option value={14}>2 týdny předem</option>
                </select>
                {bdayRemind >= 0 && (
                  <div className="space-y-1 pl-2 border-l-2 border-[var(--tint-rose)]/30">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="checkbox" checked={bdayChEmail} onChange={(e) => setBdayChEmail(e.target.checked)} className="size-4" />
                      <Mail className="size-4 text-[var(--tint-sky)]" /> Email
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm opacity-60">
                      <input type="checkbox" checked={bdayChWhats} onChange={(e) => setBdayChWhats(e.target.checked)} className="size-4" />
                      <MessageCircle className="size-4 text-[var(--tint-mint)]" /> WhatsApp
                      <span className="text-[10px] font-mono text-muted-foreground">(brzy)</span>
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Telefony</label>
              <button onClick={() => setPhones([...phones, { number: "", label: "mobile" }])} className="text-xs font-mono text-muted-foreground hover:text-foreground">
                + přidat
              </button>
            </div>
            {phones.map((p, i) => (
              <div key={i} className="flex gap-2 mb-1.5">
                <Input
                  value={p.number}
                  onChange={(e) => {
                    const copy = [...phones];
                    copy[i] = { ...copy[i], number: e.target.value };
                    setPhones(copy);
                  }}
                  placeholder="+420 777 …"
                  className="flex-1 font-mono"
                />
                <select
                  value={p.label}
                  onChange={(e) => {
                    const copy = [...phones];
                    copy[i] = { ...copy[i], label: e.target.value };
                    setPhones(copy);
                  }}
                  className="px-2 rounded-md bg-background/40 border border-border/60 text-sm"
                >
                  <option value="mobile">mobile</option>
                  <option value="work">work</option>
                  <option value="home">home</option>
                  <option value="other">other</option>
                </select>
                <button
                  onClick={() => setPhones(phones.filter((_, idx) => idx !== i))}
                  className="p-1.5 text-muted-foreground hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Emaily</label>
              <button onClick={() => setEmails([...emails, { email: "", label: "" }])} className="text-xs font-mono text-muted-foreground hover:text-foreground">
                + přidat
              </button>
            </div>
            {emails.map((em, i) => (
              <div key={i} className="flex gap-2 mb-1.5">
                <Input
                  value={em.email}
                  onChange={(e) => {
                    const copy = [...emails];
                    copy[i] = { ...copy[i], email: e.target.value };
                    setEmails(copy);
                  }}
                  placeholder="email@…"
                  className="flex-1"
                />
                <button
                  onClick={() => setEmails(emails.filter((_, idx) => idx !== i))}
                  className="p-1.5 text-muted-foreground hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Poznámka</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 focus:border-primary focus:outline-none text-sm resize-none"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{error}</div>
        )}

        <div className="flex gap-2 pt-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Save /> Uložit</>}
          </Button>
          <Button variant="ghost" onClick={() => onClose(false)}>Zrušit</Button>
        </div>
      </div>
    </div>
  );
}


// =============================================================================
// VIP link sekce — privátní URL na /call-log s tokenem
// =============================================================================

function VipLinkSection({ contactId, initialToken }: { contactId: string; initialToken: string | null }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Pokud token chybí (kontakt právě označen VIP, ještě neuložen), GET ho dotáhne.
  useEffect(() => {
    if (token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/contacts/${contactId}/call-log-token`);
        const data = await res.json();
        if (!cancelled && res.ok) setToken(data.token);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const url = token ? `${typeof window !== "undefined" ? window.location.origin : "https://www.raseliniste.cz"}/call-log?t=${token}` : "";

  async function regenerate() {
    if (!confirm("Vygenerovat nový token? Stávající VIP link přestane fungovat — musíš ho znovu poslat.")) return;
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/call-log-token`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "Regenerace selhala."); return; }
      setToken(data.token);
    } finally { setLoading(false); }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="rounded-md border border-[var(--tint-rose)]/30 bg-[var(--tint-rose)]/[0.05] p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
        VIP link (privátní)
      </div>
      {loading && !token ? (
        <div className="text-xs text-muted-foreground italic flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" /> Generuji token…
        </div>
      ) : token ? (
        <>
          <div className="text-xs font-mono break-all bg-background/40 rounded px-2 py-1.5 border border-border/40">
            {url}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={copy} disabled={loading}>
              {copied ? "Zkopírováno" : "Kopírovat link"}
            </Button>
            <Button variant="ghost" onClick={regenerate} disabled={loading}>
              {loading ? <Loader2 className="size-3 animate-spin" /> : "Regenerovat"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
            Pošli VIPce tenhle odkaz (WhatsApp / SMS / e-mail). Otevře jim formulář
            na zadání mise + výpis Giďoušových misí. Regenerace zruší předchozí link.
          </p>
        </>
      ) : (
        <div className="text-xs text-muted-foreground italic">Token zatím nevygenerován. Ulož kontakt a otevři znovu.</div>
      )}
      {err && <div className="text-xs text-destructive">{err}</div>}
    </div>
  );
}

// =============================================================================
// Backfill VIP tokenů — pro VIP kontakty které byly VIP před deployem
// callLogToken commitu (a nemají token). One-shot button v toolbaru.
// =============================================================================

function BackfillTokensButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ generated: number; failed: number } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/contacts/backfill-tokens", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Backfill selhal.");
        return;
      }
      setResult({ generated: data.generated.length, failed: data.failed.length });
      onDone();
      setTimeout(() => setResult(null), 5000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" onClick={run} disabled={busy} title="Vygeneruje VIP linky pro existující VIP kontakty bez tokenu">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <LinkIcon className="size-4" />}
        VIP tokeny
      </Button>
      {result && (
        <span className="text-xs font-mono text-[var(--tint-sage)]">
          {result.generated} nových{result.failed > 0 && `, ${result.failed} chyb`}
        </span>
      )}
    </div>
  );
}

/**
 * Alias input field — comma-separated input + chip list pod ním.
 * Pro Contact.aliases a Contact.clientTagAliases v edit modalu.
 */
function AliasField({
  label,
  hint,
  value,
  onChange,
  tint,
  disabled = false,
  disabledReason,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  tint: "lavender" | "sky" | "mint";
  disabled?: boolean;
  disabledReason?: string;
}) {
  // Live preview chipů — co bude uloženo (trim + lowercase + dedup)
  const chips = Array.from(new Set(
    value.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0),
  ));

  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-1">
        {label}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={disabled ? disabledReason ?? "" : "alias1, alias2, alias3"}
        disabled={disabled}
      />
      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{hint}</p>
      {chips.length > 0 && !disabled && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {chips.map((c, i) => (
            <span
              key={i}
              className="text-[11px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: `color-mix(in oklch, var(--tint-${tint}) 14%, transparent)`,
                color: `color-mix(in oklch, var(--tint-${tint}) 92%, white)`,
                border: `1px solid color-mix(in oklch, var(--tint-${tint}) 30%, transparent)`,
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
