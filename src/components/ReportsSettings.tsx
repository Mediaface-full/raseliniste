import { useEffect, useState } from "react";
import { Check, Inbox, Loader2, Mail, Send, TriangleAlert } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

type ReportsConfig = {
  notificationEmail: string | null;
  envDefaults: {
    notificationFrom: string | null;
    envNotificationEmail: string | null;
    resendConfigured: boolean;
  };
};

export default function ReportsSettings() {
  const [cfg, setCfg] = useState<ReportsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/reports");
      const data = await res.json();
      if (res.ok) {
        setCfg(data);
        setEmail(data.notificationEmail ?? "");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/reports", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationEmail: email.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Uložení selhalo.");
        return;
      }
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 3000);
      load();
    } catch {
      setError("Síťová chyba.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="glass rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Načítám…
      </div>
    );
  }

  if (!cfg) return null;

  const envActive = cfg.envDefaults.resendConfigured;
  const effectiveTo = email.trim() || cfg.envDefaults.envNotificationEmail || "— nenastaveno —";

  return (
    <div className="space-y-5">
      {/* Heading */}
      <div>
        <h2 className="font-serif text-xl">E-mailové reporty</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Kam se mají posílat automatické měsíční zdravotní reporty (a další notifikace v budoucnu).
        </p>
      </div>

      {/* Status karta: Resend configured? */}
      <div
        className="glass rounded-xl p-4 flex items-start gap-3"
        style={{ ["--c" as string]: envActive ? "var(--tint-sage)" : "var(--tint-butter)" }}
      >
        <div
          className="size-9 rounded-md grid place-items-center shrink-0"
          style={{ background: "color-mix(in oklch, var(--c) 16%, transparent)", color: "var(--c)" }}
        >
          {envActive ? <Check className="size-4" /> : <TriangleAlert className="size-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">
            {envActive ? "Odesílání mailů připravené" : "Odesílání mailů zatím neaktivní"}
          </div>
          <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
            {envActive ? (
              <>
                <div>Resend API klíč je nakonfigurován.</div>
                <div>
                  Odesílatel:{" "}
                  <code className="font-mono">{cfg.envDefaults.notificationFrom ?? "—"}</code>
                </div>
              </>
            ) : (
              <>
                <div>
                  V <code className="font-mono">.env</code> chybí <code className="font-mono">RESEND_API_KEY</code> nebo <code className="font-mono">NOTIFICATION_FROM</code>.
                </div>
                <div>
                  Maily se zatím nebudou odesílat (v dev módu se logují do konzole; cron endpoint stále uloží analýzu do historie).
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Formulář: Kam posílat (sběrný email) */}
      <div className="glass rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Inbox className="size-4 text-muted-foreground" />
          <h3 className="font-serif text-lg">Kam posílat reporty</h3>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="report-email" className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
            Soukromá e-mailová adresa (sběrný)
          </label>
          <div className="relative">
            <Mail className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="report-email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setDirty(true); }}
              disabled={saving}
              placeholder={cfg.envDefaults.envNotificationEmail ?? "petr@example.cz"}
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Pokud necháš prázdné, použije se hodnota z env (<code className="font-mono">NOTIFICATION_EMAIL</code>) nebo se report pošle jen do archivu.
          </p>
        </div>

        <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs space-y-1">
          <div className="text-muted-foreground">
            Efektivní nastavení při příštím reportu:
          </div>
          <div className="font-mono flex items-center gap-1.5">
            <Send className="size-3 text-muted-foreground" />
            <span>z <span className="text-foreground">{cfg.envDefaults.notificationFrom ?? "(není)"}</span></span>
            <span className="text-muted-foreground">→</span>
            <span>na <span className="text-foreground">{effectiveTo}</span></span>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Check /> Uložit</>}
          </Button>
          {saved && <span className="text-xs text-[var(--tint-sage)] font-mono">Uloženo </span>}
        </div>
      </div>

      {/* Pomocný blok o Resend */}
      <details className="glass rounded-xl px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" />
          Jak nastavit odesílání mailů (Resend)
        </summary>
        <div className="mt-3 text-sm text-muted-foreground space-y-2">
          <p>Odesílatel se nastavuje <strong className="text-foreground">v produkčním <code className="font-mono">.env</code></strong> na NASu, ne z UI (vázané na doménu):</p>
          <ol className="list-decimal list-inside space-y-1 pl-2">
            <li>Registrace na <code className="font-mono">resend.com</code> (zdarma 3 000 mailů/měs)</li>
            <li>Domains → Add <code className="font-mono">raseliniste.cz</code>, přidat TXT/MX DNS záznamy u registrátora</li>
            <li>API Keys → Create, zkopírovat do <code className="font-mono">RESEND_API_KEY</code></li>
            <li>Do <code className="font-mono">.env</code>: <code className="font-mono">NOTIFICATION_FROM=reports@raseliniste.cz</code></li>
            <li>Restart kontejneru</li>
          </ol>
          <p className="text-xs">Detailně v <code className="font-mono">HANDBOOK.md</code> sekce „Cron na Synology".</p>
        </div>
      </details>
    </div>
  );
}
