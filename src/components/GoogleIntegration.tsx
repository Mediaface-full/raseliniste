import { useState } from "react";
import {
  Calendar, Users, Loader2, Check, RefreshCcw, Trash2, AlertTriangle, Link2,
} from "lucide-react";
import { Button } from "./ui/Button";

interface Initial {
  connected: boolean;
  lastUsedAt: string | null;
  lastError: string | null;
  eventsCount: number;
  contactsCount: number;
  justConnected: boolean;
  oauthMisconfigured: boolean;
}

export default function GoogleIntegration({ initial }: { initial: Initial }) {
  const [connected, setConnected] = useState(initial.connected);
  const [eventsCount, setEventsCount] = useState(initial.eventsCount);
  const [contactsCount, setContactsCount] = useState(initial.contactsCount);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initial.lastError);
  const [message, setMessage] = useState<string | null>(
    initial.justConnected ? "✓ Google je připojený. První sync běží na pozadí." : null,
  );
  const lastUsed = initial.lastUsedAt ? new Date(initial.lastUsedAt) : null;

  async function connect() {
    setBusy("connect");
    setError(null);
    try {
      const res = await fetch("/api/integrations/google", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? "Nelze získat OAuth URL.");
        return;
      }
      // Redirect na Google consent
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!confirm("Opravdu odpojit Google? Bude nutné znovu autorizovat.")) return;
    setBusy("disconnect");
    try {
      const res = await fetch("/api/integrations/google", { method: "DELETE" });
      if (res.ok) {
        setConnected(false);
        setMessage("Google odpojen.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function sync(what: "calendar" | "contacts" | "all") {
    setBusy(`sync-${what}`);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/integrations/google/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ what }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Sync selhal.");
        return;
      }
      const parts: string[] = [];
      if (data.calendar) {
        parts.push(`Kalendář: +${data.calendar.inserted}, ~${data.calendar.updated}, -${data.calendar.deleted}`);
      }
      if (data.contacts) {
        parts.push(`Kontakty: +${data.contacts.inserted}, ~${data.contacts.updated}`);
      }
      setMessage(parts.join(" · "));

      // Refresh status
      const statusRes = await fetch("/api/integrations/google");
      const statusData = await statusRes.json();
      if (statusRes.ok) {
        setEventsCount(statusData.stats.events);
        setContactsCount(statusData.stats.contacts);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-xl">Google Workspace</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Kalendář (read-write) + Kontakty (read-only). Tvoje pracovní data, EU region, end-to-end přes OAuth.
        </p>
      </div>

      {initial.oauthMisconfigured && (
        <div className="glass rounded-xl p-4 text-sm" style={{ ["--c" as string]: "var(--tint-butter)" }}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-5 shrink-0 text-[var(--tint-butter)]" />
            <div>
              <strong>OAuth není nakonfigurovaný v .env</strong>
              <p className="mt-1 text-muted-foreground">
                Doplň <code className="font-mono">GOOGLE_CLIENT_ID</code> a{" "}
                <code className="font-mono">GOOGLE_CLIENT_SECRET</code> do <code className="font-mono">.env</code> na NASu a recreate kontejneru.
              </p>
            </div>
          </div>
        </div>
      )}

      <div
        className="glass rounded-xl p-5 space-y-3"
        style={{ ["--c" as string]: connected ? "var(--tint-sage)" : "var(--tint-lavender)" }}
      >
        <div className="flex items-center gap-2">
          <Link2 className="size-4" style={{ color: "var(--c)" }} />
          <h3 className="font-serif text-lg">Stav připojení</h3>
          {connected ? (
            <span className="ml-auto text-xs font-mono text-[var(--tint-sage)]">✓ připojeno</span>
          ) : (
            <span className="ml-auto text-xs font-mono text-muted-foreground">— nepřipojeno</span>
          )}
        </div>

        {connected ? (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 flex items-center gap-2">
                <Calendar className="size-4 text-muted-foreground" />
                <div>
                  <div className="font-mono text-lg">{eventsCount}</div>
                  <div className="text-xs text-muted-foreground">událostí</div>
                </div>
              </div>
              <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" />
                <div>
                  <div className="font-mono text-lg">{contactsCount}</div>
                  <div className="text-xs text-muted-foreground">kontaktů</div>
                </div>
              </div>
            </div>

            {lastUsed && (
              <div className="text-xs font-mono text-muted-foreground">
                Naposledy synchronizováno: {lastUsed.toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
              <Button onClick={() => sync("all")} disabled={Boolean(busy)}>
                {busy === "sync-all" ? <><Loader2 className="animate-spin" /> Synchronizuji…</> : <><RefreshCcw /> Sync vše</>}
              </Button>
              <Button variant="outline" onClick={() => sync("calendar")} disabled={Boolean(busy)}>
                {busy === "sync-calendar" ? <Loader2 className="animate-spin" /> : <Calendar />} Sync kalendář
              </Button>
              <Button variant="outline" onClick={() => sync("contacts")} disabled={Boolean(busy)}>
                {busy === "sync-contacts" ? <Loader2 className="animate-spin" /> : <Users />} Sync kontakty
              </Button>
              <Button variant="ghost" onClick={disconnect} disabled={Boolean(busy)} className="ml-auto">
                <Trash2 /> Odpojit
              </Button>
            </div>
          </>
        ) : (
          <Button onClick={connect} disabled={Boolean(busy) || initial.oauthMisconfigured}>
            {busy === "connect" ? <><Loader2 className="animate-spin" /> Spouštím…</> : <><Link2 /> Připojit Google</>}
          </Button>
        )}
      </div>

      {message && (
        <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2">
          <Check className="size-4" /> {message}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">
          <strong>Chyba:</strong> {error}
        </div>
      )}

      <details className="glass rounded-xl px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium">Co se synchronizuje</summary>
        <div className="mt-3 text-sm text-muted-foreground space-y-2">
          <div>
            <strong className="text-foreground">Kalendář (Calendar API):</strong> primary kalendář, okno [-7 dní, +60 dní],
            recurring events expanded na instances. Sync à 5 min přes cron.
          </div>
          <div>
            <strong className="text-foreground">Kontakty (People API):</strong> tvoje "My Contacts" v Google,
            read-only. Dedup s existujícími podle e-mailu / telefonu. Sync 1× denně 04:00.
          </div>
          <div>
            <strong className="text-foreground">Co NEděláme:</strong> nepíšeme do iCloud kalendářů, needitujeme
            tvoje Google kontakty (jen čteme), nemažeme nic v Google.
          </div>
        </div>
      </details>
    </div>
  );
}
