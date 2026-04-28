import { useState, useEffect } from "react";
import {
  Cloud, Loader2, Check, RefreshCcw, Trash2, AlertTriangle, Link2, Baby, UserRound,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface CalendarInfo {
  url: string;
  displayName: string;
}

interface Initial {
  connected: boolean;
  appleId: string | null;
  sonCalendarName: string | null;
  partnerCalendarName: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  stats: { sonEvents: number; partnerEvents: number };
}

export default function IcloudIntegration({ initial }: { initial: Initial }) {
  const [connected, setConnected] = useState(initial.connected);
  const [appleId, setAppleId] = useState(initial.appleId ?? "");
  const [appPassword, setAppPassword] = useState("");
  const [sonName, setSonName] = useState(initial.sonCalendarName ?? "");
  const [partnerName, setPartnerName] = useState(initial.partnerCalendarName ?? "");
  const [stats, setStats] = useState(initial.stats);
  const [lastUsed, setLastUsed] = useState<Date | null>(
    initial.lastUsedAt ? new Date(initial.lastUsedAt) : null,
  );

  const [calendars, setCalendars] = useState<CalendarInfo[] | null>(null);
  const [sonUrl, setSonUrl] = useState("");
  const [partnerUrl, setPartnerUrl] = useState("");

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initial.lastError);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (connected && !calendars) {
      void loadCalendars();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  async function loadCalendars() {
    setBusy("calendars");
    setError(null);
    try {
      const res = await fetch("/api/integrations/icloud/calendars");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Nelze načíst kalendáře.");
        return;
      }
      setCalendars(data.calendars ?? []);
      // Pre-select uloženou volbu, pokud sedí na URL
      const son = data.calendars?.find((c: CalendarInfo) => c.displayName === sonName);
      const partner = data.calendars?.find((c: CalendarInfo) => c.displayName === partnerName);
      if (son) setSonUrl(son.url);
      if (partner) setPartnerUrl(partner.url);
    } finally {
      setBusy(null);
    }
  }

  async function saveCredentials() {
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/integrations/icloud", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appleId, appPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Uložení selhalo.");
        return;
      }
      setConnected(true);
      setAppPassword("");
      setMessage("Credentials uložené. Teď vyber kalendáře.");
      await loadCalendars();
    } finally {
      setBusy(null);
    }
  }

  async function saveSelection() {
    setBusy("select");
    setError(null);
    setMessage(null);
    try {
      const sonCal = calendars?.find((c) => c.url === sonUrl);
      const partnerCal = calendars?.find((c) => c.url === partnerUrl);
      const res = await fetch("/api/integrations/icloud/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sonCalendarUrl: sonCal?.url ?? "",
          sonCalendarName: sonCal?.displayName ?? "",
          partnerCalendarUrl: partnerCal?.url ?? "",
          partnerCalendarName: partnerCal?.displayName ?? "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Uložení výběru selhalo.");
        return;
      }
      setSonName(sonCal?.displayName ?? "");
      setPartnerName(partnerCal?.displayName ?? "");
      setMessage("Výběr uložen. Teď klikni Sync vše, ať se události stáhnou.");
    } finally {
      setBusy(null);
    }
  }

  async function sync(what: "son" | "partner" | "all") {
    setBusy(`sync-${what}`);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/integrations/icloud/sync", {
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
      if (data.son) parts.push(`Syn: +${data.son.inserted}, ~${data.son.updated}, -${data.son.deleted}`);
      if (data.partner) parts.push(`Partnerka: +${data.partner.inserted}, ~${data.partner.updated}, -${data.partner.deleted}`);
      if (data.errors?.length) parts.push(`chyby: ${data.errors.join(" · ")}`);
      setMessage(parts.join(" · ") || "Sync hotov.");

      // Refresh stats
      const statusRes = await fetch("/api/integrations/icloud");
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setStats(statusData.stats);
        if (statusData.lastUsedAt) setLastUsed(new Date(statusData.lastUsedAt));
      }
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!confirm("Opravdu odpojit iCloud? Bude nutné znovu zadat Apple ID a app password.")) return;
    setBusy("disconnect");
    try {
      const res = await fetch("/api/integrations/icloud", { method: "DELETE" });
      if (res.ok) {
        setConnected(false);
        setCalendars(null);
        setAppleId("");
        setSonName("");
        setPartnerName("");
        setSonUrl("");
        setPartnerUrl("");
        setMessage("iCloud odpojen.");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-xl">iCloud kalendáře</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Read-only čtení dvou sdílených kalendářů: synův program (hokej) + partnerčin (NOCNI/DENNI šichty).
          Žádné zápisy zpět do iCloudu.
        </p>
      </div>

      {!connected && (
        <div
          className="glass rounded-xl p-5 space-y-4"
          style={{ ["--c" as string]: "var(--tint-lavender)" }}
        >
          <div>
            <h3 className="font-serif text-lg">1. Apple ID + app-specific password</h3>
            <p className="text-sm text-muted-foreground mt-1">
              App password vygeneruj na <a href="https://appleid.apple.com" target="_blank" rel="noreferrer" className="underline">appleid.apple.com</a> →
              Sign-In and Security → App-Specific Passwords. Apple ti ho ukáže <strong>jen jednou</strong>.
            </p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Apple ID (email)</label>
              <Input
                type="email"
                placeholder="ty@me.com"
                value={appleId}
                onChange={(e) => setAppleId(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="text-sm font-medium">App-specific password</label>
              <Input
                type="password"
                placeholder="xxxx-xxxx-xxxx-xxxx"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <Button onClick={saveCredentials} disabled={Boolean(busy) || !appleId || !appPassword}>
              {busy === "save" ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Link2 /> Připojit</>}
            </Button>
          </div>
        </div>
      )}

      {connected && (
        <>
          <div
            className="glass rounded-xl p-5 space-y-3"
            style={{ ["--c" as string]: "var(--tint-sage)" }}
          >
            <div className="flex items-center gap-2">
              <Cloud className="size-4" style={{ color: "var(--c)" }} />
              <h3 className="font-serif text-lg">Stav</h3>
              <span className="ml-auto text-xs font-mono text-[var(--tint-sage)]">✓ připojeno</span>
            </div>
            <div className="text-sm text-muted-foreground font-mono">{appleId}</div>
            {lastUsed && (
              <div className="text-xs font-mono text-muted-foreground">
                Naposledy synchronizováno:{" "}
                {lastUsed.toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm pt-2">
              <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 flex items-center gap-2">
                <Baby className="size-4 text-muted-foreground" />
                <div>
                  <div className="font-mono text-lg">{stats.sonEvents}</div>
                  <div className="text-xs text-muted-foreground">syn ({sonName || "—"})</div>
                </div>
              </div>
              <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 flex items-center gap-2">
                <UserRound className="size-4 text-muted-foreground" />
                <div>
                  <div className="font-mono text-lg">{stats.partnerEvents}</div>
                  <div className="text-xs text-muted-foreground">partnerka ({partnerName || "—"})</div>
                </div>
              </div>
            </div>
          </div>

          <div
            className="glass rounded-xl p-5 space-y-4"
            style={{ ["--c" as string]: "var(--tint-sky)" }}
          >
            <h3 className="font-serif text-lg">Výběr kalendářů</h3>
            {!calendars ? (
              <Button onClick={loadCalendars} disabled={busy === "calendars"}>
                {busy === "calendars" ? <><Loader2 className="animate-spin" /> Načítám…</> : <><RefreshCcw /> Načíst seznam</>}
              </Button>
            ) : calendars.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Žádné kalendáře nenalezeny. Zkontroluj že Apple ID + heslo jsou správné.
              </div>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Baby className="size-3.5" /> Kalendář syna (hokej)
                  </label>
                  <select
                    className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
                    value={sonUrl}
                    onChange={(e) => setSonUrl(e.target.value)}
                  >
                    <option value="">— vyber —</option>
                    {calendars.map((c) => (
                      <option key={c.url} value={c.url}>{c.displayName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <UserRound className="size-3.5" /> Kalendář partnerky (šichty)
                  </label>
                  <select
                    className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
                    value={partnerUrl}
                    onChange={(e) => setPartnerUrl(e.target.value)}
                  >
                    <option value="">— vyber —</option>
                    {calendars.map((c) => (
                      <option key={c.url} value={c.url}>{c.displayName}</option>
                    ))}
                  </select>
                </div>
                <Button onClick={saveSelection} disabled={Boolean(busy)}>
                  {busy === "select" ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Check /> Uložit výběr</>}
                </Button>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => sync("all")} disabled={Boolean(busy)}>
              {busy === "sync-all" ? <><Loader2 className="animate-spin" /> Synchronizuji…</> : <><RefreshCcw /> Sync vše</>}
            </Button>
            <Button variant="outline" onClick={() => sync("son")} disabled={Boolean(busy) || !sonName}>
              {busy === "sync-son" ? <Loader2 className="animate-spin" /> : <Baby />} Sync syn
            </Button>
            <Button variant="outline" onClick={() => sync("partner")} disabled={Boolean(busy) || !partnerName}>
              {busy === "sync-partner" ? <Loader2 className="animate-spin" /> : <UserRound />} Sync partnerka
            </Button>
            <Button variant="ghost" onClick={disconnect} disabled={Boolean(busy)} className="ml-auto">
              <Trash2 /> Odpojit
            </Button>
          </div>
        </>
      )}

      {message && (
        <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2">
          <Check className="size-4" /> {message}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div><strong>Chyba:</strong> {error}</div>
        </div>
      )}

      <details className="glass rounded-xl px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium">Co se synchronizuje</summary>
        <div className="mt-3 text-sm text-muted-foreground space-y-2">
          <div>
            <strong className="text-foreground">Synův kalendář:</strong> události s názvem „hokej / trénink"
            klasifikované jako <code className="font-mono">HOCKEY_SON</code>, ostatní jako <code>PERSONAL</code>.
            Hokejové bloky jsou tvrdá překážka pro booking sloty.
          </div>
          <div>
            <strong className="text-foreground">Partnerčin kalendář:</strong> celodenní události začínající
            na <code>NOCNI</code> nebo <code>DENNI</code> → <code>PARTNER_SHIFT</code>. Dovolená → <code>PARTNER_VACATION</code>.
            Šichty hrají roli v pravidle „doma s klientem když má NOCNI/DENNI = warning".
          </div>
          <div>
            <strong className="text-foreground">Sync:</strong> okno [-7 dní, +60 dní], à 5 minut přes cron.
            Read-only — do iCloudu nikdy nezapisujeme.
          </div>
        </div>
      </details>
    </div>
  );
}
