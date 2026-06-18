import { useEffect, useState } from "react";
import { Check, Loader2, Mail, TriangleAlert, Server, Key, User as UserIcon, Send, Trash2, AtSign, Inbox } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

type Preset = {
  name: string;
  host: string;
  port: number;
  secure: boolean;
  hint: string;
};

const PRESETS: Preset[] = [
  { name: "Seznam", host: "smtp.seznam.cz", port: 465, secure: true, hint: "Prihlaseni plnou adresou" },
  { name: "Gmail", host: "smtp.gmail.com", port: 465, secure: true, hint: "Vyzaduje heslo pro aplikace (2FA)" },
  { name: "Outlook", host: "smtp.office365.com", port: 587, secure: false, hint: "STARTTLS na 587" },
  { name: "Vlastni", host: "", port: 465, secure: true, hint: "Vlastni SMTP server" },
];

interface Props {
  initialReportEmail: string | null;
  envNotificationEmail: string | null;
}

export default function MailSettings({ initialReportEmail, envNotificationEmail }: Props) {
  // ---- Stav formuláře ----
  const [host, setHost] = useState("smtp.seznam.cz");
  const [port, setPort] = useState(465);
  const [secure, setSecure] = useState(true);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");
  const [presetName, setPresetName] = useState("Seznam");

  // ---- Stav serveru ----
  const [configured, setConfigured] = useState(false);
  const [lastUsedAt, setLastUsedAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // ---- Report email (kam posílat) ----
  const [reportEmail, setReportEmail] = useState(initialReportEmail ?? "");
  const [reportDirty, setReportDirty] = useState(false);

  // ---- UI flags ----
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/mail");
      const data = await res.json();
      if (res.ok && data.configured) {
        setConfigured(true);
        setHost(data.host);
        setPort(data.port);
        setSecure(data.secure);
        setUser(data.user);
        setFrom(data.from);
        setLastUsedAt(data.lastUsedAt);
        setLastError(data.lastError);
        // Najdi matching preset
        const p = PRESETS.find((x) => x.host === data.host);
        setPresetName(p?.name ?? "Vlastní");
      } else {
        setConfigured(false);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function applyPreset(name: string) {
    const p = PRESETS.find((x) => x.name === name);
    if (!p) return;
    setPresetName(name);
    if (p.host) setHost(p.host);
    setPort(p.port);
    setSecure(p.secure);
  }

  async function saveConfig() {
    setMsg(null);
    setSaving(true);
    try {
      const res = await fetch("/api/settings/mail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          host: host.trim(),
          port,
          secure,
          user: user.trim(),
          password,
          from: from.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: data.error ?? "Uložení selhalo." });
        return;
      }
      setMsg({ type: "ok", text: "SMTP uloženo. Přihlášení ověřeno." });
      setPassword("");
      load();
    } catch {
      setMsg({ type: "err", text: "Síťová chyba." });
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setMsg(null);
    setSendingTest(true);
    try {
      const to = reportEmail.trim() || envNotificationEmail || "";
      if (!to) {
        setMsg({ type: "err", text: "Nejdřív vlož e-mail, kam má test přijít." });
        return;
      }
      const res = await fetch("/api/settings/mail/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMsg({ type: "err", text: data.error ?? "Test selhal." });
        return;
      }
      setMsg({ type: "ok", text: `Test odeslán (${data.provider}). Zkontroluj schránku ${to}.` });
      load();
    } catch {
      setMsg({ type: "err", text: "Síťová chyba." });
    } finally {
      setSendingTest(false);
    }
  }

  async function removeSmtp() {
    if (!confirm("Opravdu smazat SMTP konfiguraci? Maily půjdou do logu nebo přes Resend.")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/mail", { method: "DELETE" });
      if (res.ok) {
        setConfigured(false);
        setLastUsedAt(null);
        setLastError(null);
        setPassword("");
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveReportEmail() {
    setSavingReport(true);
    try {
      const res = await fetch("/api/settings/reports", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationEmail: reportEmail.trim() || null }),
      });
      if (res.ok) {
        setReportDirty(false);
        setMsg({ type: "ok", text: "E-mail příjemce uložen." });
      }
    } finally {
      setSavingReport(false);
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
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-xl">E-mail</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Odchozí SMTP server (pro notifikace a reporty) a kam se má posílat.
        </p>
      </div>

      {/* Kam posílat */}
      <div className="glass rounded-xl p-5 space-y-3" style={{ ["--c" as string]: "var(--tint-butter)" }}>
        <div className="flex items-center gap-2">
          <Inbox className="size-4" style={{ color: "var(--c)" }} />
          <h3 className="font-serif text-lg">Kam chodí reporty a notifikace</h3>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
            Tvůj sběrný e-mail
          </label>
          <div className="relative">
            <AtSign className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="email"
              value={reportEmail}
              onChange={(e) => { setReportEmail(e.target.value); setReportDirty(true); }}
              placeholder={envNotificationEmail ?? "ja@example.cz"}
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Sem chodí VIP/urgent vzkazy z firewallu a měsíční zdravotní reporty.
          </p>
        </div>
        {reportDirty && (
          <Button size="sm" onClick={saveReportEmail} disabled={savingReport}>
            {savingReport ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Check /> Uložit e-mail</>}
          </Button>
        )}
      </div>

      {/* SMTP konfigurace */}
      <div className="glass rounded-xl p-5 space-y-4" style={{ ["--c" as string]: "var(--tint-mint)" }}>
        <div className="flex items-center gap-2">
          <Server className="size-4" style={{ color: "var(--c)" }} />
          <h3 className="font-serif text-lg">Odchozí SMTP server</h3>
          {configured && (
            <span className="ml-auto text-xs font-mono text-[var(--tint-sage)]">aktivní</span>
          )}
        </div>

        {/* Preset selector */}
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => applyPreset(p.name)}
              className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                presetName === p.name
                  ? "bg-[color-mix(in_oklch,var(--c)_20%,transparent)] text-foreground"
                  : "bg-white/5 text-muted-foreground hover:bg-white/10"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Host</label>
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.seznam.cz" className="font-mono" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Port</label>
            <Input type="number" value={port} onChange={(e) => setPort(parseInt(e.target.value, 10) || 465)} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer pb-2 text-sm">
              <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} className="size-4" />
              TLS (465)
            </label>
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Přihlašovací jméno (plná e-mailová adresa)
          </label>
          <div className="relative">
            <UserIcon className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={user} onChange={(e) => {
              setUser(e.target.value);
              if (!from) setFrom(e.target.value);
            }} placeholder="oko@raseliniste.cz" className="pl-9" />
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Heslo {configured && <span className="text-[var(--tint-sage)]">· uložené, zadej jen při změně</span>}
          </label>
          <div className="relative">
            <Key className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={configured ? "•••••••• (nech prázdné)" : "heslo k účtu"}
              className="pl-9 font-mono"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Odesílatel (FROM)
          </label>
          <div className="relative">
            <Mail className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="oko@raseliniste.cz" className="pl-9" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Většina serverů vyžaduje, aby FROM bylo stejné jako přihlašovací jméno (jinak dostaneš 550 Not authenticated as sender).
          </p>
        </div>

        {configured && lastError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-xs px-3 py-2 flex items-start gap-2">
            <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Poslední chyba při odesílání:</div>
              <div className="font-mono mt-1">{lastError}</div>
            </div>
          </div>
        )}
        {configured && lastUsedAt && !lastError && (
          <div className="text-xs font-mono text-muted-foreground">
            Naposledy použito: {new Date(lastUsedAt).toLocaleString("cs-CZ")}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={saveConfig} disabled={saving || (!configured && !password)}>
            {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Check /> {configured ? "Uložit změny" : "Uložit + ověřit"}</>}
          </Button>
          {configured && (
            <Button variant="outline" onClick={sendTest} disabled={sendingTest}>
              {sendingTest ? <><Loader2 className="animate-spin" /> Odesílám…</> : <><Send /> Poslat testovací mail</>}
            </Button>
          )}
          {configured && (
            <Button variant="ghost" onClick={removeSmtp} disabled={saving}>
              <Trash2 /> Smazat
            </Button>
          )}
        </div>
      </div>

      {/* Zpráva (ok / error) */}
      {msg && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            msg.type === "ok"
              ? "border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-foreground"
              : "border border-destructive/30 bg-destructive/10 text-foreground"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Nápověda */}
      <details className="glass rounded-xl px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" />
          Jak získat hodnoty pro Seznam
        </summary>
        <div className="mt-3 text-sm text-muted-foreground space-y-2">
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li><strong>Host:</strong> <code className="font-mono">smtp.seznam.cz</code></li>
            <li><strong>Port:</strong> <code className="font-mono">465</code> (SSL/TLS)</li>
            <li><strong>Uživatel:</strong> plná adresa, např. <code className="font-mono">oko@raseliniste.cz</code></li>
            <li><strong>Heslo:</strong> stejné jako do e.seznam.cz</li>
            <li><strong>FROM:</strong> stejné jako uživatel</li>
          </ul>
          <p className="mt-2">Seznam ti nedovolí posílat s FROM = cizí adresa. Musí to být tvoje schránka, kam se loguješ.</p>
        </div>
      </details>
    </div>
  );
}
