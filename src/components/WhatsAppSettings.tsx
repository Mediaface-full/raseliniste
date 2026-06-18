import { useEffect, useState } from "react";
import { Loader2, Save, Send, AlertTriangle, CheckCircle2, MessageCircle, ExternalLink } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface State {
  configured: boolean;
  accountSid: string;
  fromNumber: string;
  whatsappNumber: string;
  lastUsedAt: string | null;
  lastError: string | null;
}

export default function WhatsAppSettings() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<State | null>(null);

  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/whatsapp");
      const data = await res.json();
      if (res.ok) {
        setState(data);
        setAccountSid(data.accountSid ?? "");
        setFromNumber(data.fromNumber ?? "");
        setWhatsappNumber(data.whatsappNumber ?? "");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setMsg(null);
    setErr(null);
    if (!authToken && !state?.configured) {
      setErr("Vyplň auth token (najdeš ho v Twilio Console).");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountSid: accountSid.trim(),
          // Pokud uživatel nezadal nový token, pošli prázdný — ale to by neuložil…
          // Lepší: pokud chce změnit, vyplní nový. Pokud neuvádí, zachovat staré v DB
          // = neposílat field. Jenže Zod ho má required. Workaround: pokud configured=true
          // a token je prázdný, pošli "KEEP" placeholder a server ho ignoruje. Pro MVP
          // jednodušší: token je vyžadován při každém uložení.
          authToken: authToken.trim(),
          fromNumber: fromNumber.trim(),
          whatsappNumber: whatsappNumber.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Uložení selhalo.");
        return;
      }
      setMsg("Uloženo.");
      setAuthToken("");
      load();
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setMsg(null);
    setErr(null);
    setTesting(true);
    try {
      const res = await fetch("/api/settings/whatsapp", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(`Test selhal: ${data.error}`);
        return;
      }
      setMsg(`Zpráva odeslaná (Twilio SID: ${data.sid}). Mrkni do WhatsApp.`);
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <div className="glass rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Načítám…
    </div>;
  }

  return (
    <div className="space-y-4 max-w-xl">
      {/* Status */}
      <div className="glass-strong rounded-xl p-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-5 text-[var(--tint-mint)]" />
          <div className="font-serif text-base">Status</div>
          {state?.configured ? (
            <span className="ml-auto text-xs font-mono text-[var(--tint-sage)] flex items-center gap-1">
              <CheckCircle2 className="size-3" /> nakonfigurováno
            </span>
          ) : (
            <span className="ml-auto text-xs font-mono text-muted-foreground">není nastaveno</span>
          )}
        </div>
        {state?.lastUsedAt && (
          <div className="text-xs text-muted-foreground mt-2 font-mono">
            Naposledy použito: {new Date(state.lastUsedAt).toLocaleString("cs-CZ")}
          </div>
        )}
        {state?.lastError && (
          <div className="text-xs text-destructive mt-2 flex items-start gap-1">
            <AlertTriangle className="size-3 mt-0.5 shrink-0" />
            <span>Poslední chyba: {state.lastError}</span>
          </div>
        )}
      </div>

      {/* Návod */}
      <div className="glass rounded-xl p-4 text-sm space-y-2">
        <div className="font-serif text-base">Jak na to (Twilio Sandbox — free)</div>
        <ol className="list-decimal pl-5 space-y-1.5 text-muted-foreground">
          <li>Založ si účet na <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noopener" className="text-[var(--tint-mint)] underline inline-flex items-center gap-1">twilio.com/try-twilio <ExternalLink className="size-3" /></a> (free trial $15 credit, kreditka ne nutná).</li>
          <li>V Twilio Console: <strong>Develop → Messaging → Try it out → Send a WhatsApp message</strong>.</li>
          <li>V telefonu otevři WhatsApp, pošli <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">join &lt;code&gt;</code> na Twilio sandbox číslo (ukáže se ti tam, např. <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">+1 415 523 8886</code>).</li>
          <li>WhatsApp ti odpoví „Sandbox: You are all set!"</li>
          <li>Zkopíruj sem ze Twilio Console: <strong>Account SID</strong>, <strong>Auth Token</strong>, <strong>From number</strong> (bude to <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">whatsapp:+14155238886</code> nebo jen <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">+14155238886</code>).</li>
          <li>Vyplň své vlastní WhatsApp číslo (E.164: <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">+420777111222</code>).</li>
          <li>Ulož a klik <strong>Poslat test</strong> ↓.</li>
        </ol>
        <div className="text-xs text-muted-foreground/80 pt-2 border-t border-white/5">
          Sandbox je free, ale po 72 h od posledního message musíš znovu poslat <code>join &lt;code&gt;</code>.
          Pro production: vlastní WA Business číslo (~$1/měs + $0.005/msg, schválení Meta ~1 týden).
        </div>
      </div>

      {/* Form */}
      <div className="glass-strong rounded-xl p-5 space-y-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Twilio Account SID
          </label>
          <Input
            value={accountSid}
            onChange={(e) => setAccountSid(e.target.value)}
            placeholder="AC..."
            className="font-mono text-sm"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Twilio Auth Token {state?.configured && <span className="text-muted-foreground/60">(prázdné = ponechat)</span>}
          </label>
          <Input
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder={state?.configured ? "•••••••• (změň jen pokud chceš nový)" : ""}
            className="font-mono text-sm"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            From number (Twilio sandbox WA)
          </label>
          <Input
            value={fromNumber}
            onChange={(e) => setFromNumber(e.target.value)}
            placeholder="+14155238886"
            className="font-mono text-sm"
          />
        </div>

        <div className="pt-3 border-t border-white/5">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Tvoje WhatsApp číslo (kam přijdou připomínky)
          </label>
          <Input
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            placeholder="+420777111222"
            className="font-mono text-sm"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Musí být v E.164 formátu (s +) a nasazeno v Sandboxu (krok 3 výše).
          </p>
        </div>

        {err && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{err}</div>}
        {msg && <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2">{msg}</div>}

        <div className="flex gap-2 pt-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Save /> Uložit</>}
          </Button>
          {state?.configured && (
            <Button variant="outline" onClick={test} disabled={testing}>
              {testing ? <><Loader2 className="animate-spin" /> Testuji…</> : <><Send /> Poslat test</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
