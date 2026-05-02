import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Search, Star, Trash2, Upload, Phone as PhoneIcon, Mail, Save, X, Link as LinkIcon, MessageCircle } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Contact {
  id: string;
  displayName: string;
  firstName: string | null;
  firstNameVocative: string | null;
  greetingOverride: string | null;
  lastName: string | null;
  note: string | null;
  isVip: boolean;
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

export default function ContactsManager() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [vipOnly, setVipOnly] = useState(false);
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (vipOnly) params.set("vip", "1");
      const res = await fetch("/api/contacts?" + params.toString());
      const data = await res.json();
      if (res.ok) setContacts(data.contacts);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q, vipOnly]);

  async function toggleVip(c: Contact) {
    const res = await fetch(`/api/contacts/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isVip: !c.isVip }),
    });
    if (res.ok) load();
  }

  async function remove(c: Contact) {
    if (!confirm(`Smazat ${c.displayName}?`)) return;
    const res = await fetch(`/api/contacts/${c.id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  const [copied, setCopied] = useState<string | null>(null);
  async function copyLink(c: Contact) {
    const phone = c.phones[0]?.number ?? "";
    const params = new URLSearchParams();
    if (phone) params.set("phone", phone);
    // Jméno v URL je jen hint — server si ho stejně ověří proti DB (VIP flag)
    // a pokud kontakt není VIP, oslovení nezobrazí. Pošleme ho proto vždy,
    // ať link funguje i kdyby se status později změnil.
    const firstName = c.firstName?.trim() || c.displayName.split(" ")[0];
    if (firstName) params.set("name", firstName);
    const base = typeof window !== "undefined" ? window.location.origin : "https://www.raseliniste.cz";
    const link = `${base}/call-log?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(c.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // fallback — prompt
      prompt("Zkopíruj tento odkaz:", link);
    }
  }

  async function importVcf(file: File) {
    const text = await file.text();
    const CHUNK = 50;
    let offset = 0;
    let total = 0;
    let created = 0, updated = 0, skipped = 0;
    const allErrors: string[] = [];

    setImportMsg("Importuji… 0 %");

    while (true) {
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, offset, limit: CHUNK }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setImportMsg(`Chyba u offsetu ${offset}: ${data.error ?? res.statusText}`);
        setTimeout(() => setImportMsg(null), 8000);
        return;
      }
      const data = await res.json();
      total = data.total;
      created += data.created;
      updated += data.updated;
      skipped += data.skipped;
      if (data.errors?.length) allErrors.push(...data.errors);

      const pct = Math.round((data.processed / total) * 100);
      setImportMsg(`Importuji… ${pct} % (${data.processed}/${total})`);
      load(); // průběžný refresh seznamu

      if (data.done) break;
      offset = data.nextOffset;
    }

    const errSuffix = allErrors.length > 0 ? ` · ${allErrors.length} chyb` : "";
    setImportMsg(`✓ Hotovo: ${created} nových, ${updated} aktualizováno, ${skipped} přeskočeno${errSuffix}`);
    load();
    setTimeout(() => setImportMsg(null), 10000);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="glass rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Hledat…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant={vipOnly ? "default" : "outline"}
          onClick={() => setVipOnly((v) => !v)}
        >
          <Star /> VIP
        </Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload /> Import .vcf
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".vcf,text/vcard,text/x-vcard"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importVcf(f);
            e.target.value = "";
          }}
        />
        <Button onClick={() => setEditing("new")}>
          <Plus /> Nový
        </Button>
      </div>

      {importMsg && (
        <div className="glass rounded-md px-4 py-2 text-sm font-mono">{importMsg}</div>
      )}

      {loading ? (
        <div className="glass rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Načítám…
        </div>
      ) : contacts.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center text-muted-foreground">
          Žádné kontakty. Klikni na <strong>Import .vcf</strong> nebo <strong>Nový</strong>.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {contacts.map((c) => (
            <div
              key={c.id}
              className="glass rounded-xl p-4 space-y-2"
              style={{
                ["--c" as string]: c.isVip ? "var(--tint-rose)" : "var(--tint-lavender)",
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="size-10 rounded-md grid place-items-center shrink-0 font-serif text-lg"
                  style={{
                    background: "color-mix(in oklch, var(--c) 16%, transparent)",
                    color: "var(--c)",
                  }}
                >
                  {c.displayName.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-medium truncate">{c.displayName}</div>
                    {c.isVip && <Star className="size-3.5 shrink-0" style={{ color: "var(--c)" }} />}
                  </div>
                  {c.phones[0] && (
                    <div className="text-xs font-mono text-muted-foreground flex items-center gap-1 mt-0.5">
                      <PhoneIcon className="size-3" /> {c.phones[0].number}
                      {c.phones.length > 1 && <span className="ml-1">+{c.phones.length - 1}</span>}
                    </div>
                  )}
                  {c.emails[0] && (
                    <div className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                      <Mail className="size-3" /> {c.emails[0].email}
                    </div>
                  )}
                  {c._count && c._count.callLogs > 0 && (
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mt-1">
                      {c._count.callLogs}× firewall
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {c.phones.length > 0 && (
                    <button
                      onClick={() => copyLink(c)}
                      className="p-1.5 rounded hover:bg-white/5 transition-colors"
                      title="Zkopírovat osobní call-log link"
                    >
                      {copied === c.id ? (
                        <span className="text-[10px] font-mono text-[var(--tint-sage)]">✓</span>
                      ) : (
                        <LinkIcon className="size-4 text-muted-foreground" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => toggleVip(c)}
                    className="p-1.5 rounded hover:bg-white/5 transition-colors"
                    title={c.isVip ? "Sundat VIP" : "Označit jako VIP"}
                  >
                    <Star
                      className="size-4"
                      style={{ color: c.isVip ? "var(--c)" : "var(--muted-foreground)" }}
                      fill={c.isVip ? "currentColor" : "none"}
                    />
                  </button>
                  <button
                    onClick={() => setEditing(c)}
                    className="p-1.5 rounded hover:bg-white/5 transition-colors text-xs font-mono text-muted-foreground"
                    title="Upravit"
                  >
                    edit
                  </button>
                  <button
                    onClick={() => remove(c)}
                    className="p-1.5 rounded hover:bg-destructive/20 transition-colors"
                    title="Smazat"
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ContactEditor
          contact={editing === "new" ? null : editing}
          onClose={(reload) => {
            setEditing(null);
            if (reload) load();
          }}
        />
      )}
    </div>
  );
}

interface EditorProps {
  contact: Contact | null;
  onClose: (reload: boolean) => void;
}

function ContactEditor({ contact, onClose }: EditorProps) {
  const [displayName, setDisplayName] = useState(contact?.displayName ?? "");
  const [firstName, setFirstName] = useState(contact?.firstName ?? "");
  const [firstNameVocative, setFirstNameVocative] = useState(contact?.firstNameVocative ?? "");
  const [greetingOverride, setGreetingOverride] = useState(contact?.greetingOverride ?? "");
  const [lastName, setLastName] = useState(contact?.lastName ?? "");
  const [note, setNote] = useState(contact?.note ?? "");
  const [isVip, setIsVip] = useState(contact?.isVip ?? false);
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={() => onClose(false)}>
      <div
        className="glass-strong rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4"
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
              {copied ? "✓ Zkopírováno" : "Kopírovat link"}
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
