import { useState } from "react";
import { Check, Loader2, MessageSquare, Trash2, TriangleAlert, RefreshCw, Copy, RotateCw } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Channel {
  id: number;
  name: string;
  sourceNumber: string;
}

interface Organization {
  currentCredit: number;
  invoicingType: "Prepaid" | "Postpaid";
  currency: "CZK" | "EUR";
  channels: Channel[];
}

interface InitialProps {
  hasCredentials: boolean;
  clientId: string | null;
  defaultChannel: number | null;
  webhookSecret: string | null;
  organization: Organization | null;
  organizationFetchedAt: string | null;
  publicBaseUrl: string;
  lastUsedAt: string | null;
  lastError: string | null;
}

export default function GosmsSettings({ initial }: { initial: InitialProps }) {
  const [hasCredentials, setHasCredentials] = useState(initial.hasCredentials);
  const [clientId, setClientId] = useState(initial.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [defaultChannel, setDefaultChannel] = useState<number | null>(initial.defaultChannel);
  const [webhookSecret, setWebhookSecret] = useState(initial.webhookSecret);
  const [organization, setOrganization] = useState<Organization | null>(initial.organization);
  const [organizationFetchedAt, setOrganizationFetchedAt] = useState<string | null>(
    initial.organizationFetchedAt,
  );

  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const lastUsed = initial.lastUsedAt ? new Date(initial.lastUsedAt) : null;
  const lastErr = initial.lastError;

  async function saveCredentials() {
    if (!clientId.trim() || !clientSecret.trim()) {
      setError("Vyplň client_id i client_secret.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/gosms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Uložení selhalo.");
        return;
      }
      setHasCredentials(true);
      setClientSecret("");
      setOrganization(data.organization);
      setOrganizationFetchedAt(new Date().toISOString());
      setWebhookSecret(data.webhookSecret);
      // pokud byl null defaultChannel, server ho nastavil na první
      if (defaultChannel === null && data.organization?.channels?.length > 0) {
        setDefaultChannel(data.organization.channels[0].id);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Síťová chyba.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshOrganization() {
    setError(null);
    setRefreshing(true);
    try {
      const res = await fetch("/api/integrations/gosms/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Refresh selhal.");
        return;
      }
      setOrganization(data.config.organization);
      setOrganizationFetchedAt(data.config.organizationFetchedAt);
    } catch {
      setError("Síťová chyba.");
    } finally {
      setRefreshing(false);
    }
  }

  async function changeDefaultChannel(channelId: number) {
    const prev = defaultChannel;
    setDefaultChannel(channelId);
    try {
      const res = await fetch("/api/integrations/gosms/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultChannel: channelId }),
      });
      if (!res.ok) {
        setDefaultChannel(prev);
        setError("Nepodařilo se nastavit kanál.");
      }
    } catch {
      setDefaultChannel(prev);
      setError("Síťová chyba.");
    }
  }

  async function regenerateWebhookSecret() {
    if (!confirm("Opravdu vygenerovat nový webhook secret? Stará URL přestane fungovat — bude potřeba ji aktualizovat v GoSMS samoobsluze.")) {
      return;
    }
    try {
      const res = await fetch("/api/integrations/gosms/regenerate-webhook-secret", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Regenerace selhala.");
        return;
      }
      setWebhookSecret(data.webhookSecret);
    } catch {
      setError("Síťová chyba.");
    }
  }

  async function disconnect() {
    if (!confirm("Odpojit GoSMS? Credentials se smažou. Historie odeslaných SMS zůstane.")) {
      return;
    }
    try {
      const res = await fetch("/api/integrations/gosms", { method: "DELETE" });
      if (res.ok) {
        setHasCredentials(false);
        setClientId("");
        setClientSecret("");
        setOrganization(null);
        setWebhookSecret(null);
      }
    } catch {
      setError("Síťová chyba.");
    }
  }

  function copyToClipboard(value: string, key: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  }

  const deliveryUrl = webhookSecret
    ? `${initial.publicBaseUrl}/api/webhooks/gosms/delivery?token=${webhookSecret}`
    : null;
  const replyUrl = webhookSecret
    ? `${initial.publicBaseUrl}/api/webhooks/gosms/reply?token=${webhookSecret}`
    : null;

  return (
    <div className="glass rounded-2xl p-6 space-y-5">
      <header className="flex items-center gap-3">
        <MessageSquare className="w-5 h-5 text-muted-foreground" />
        <div className="flex-1">
          <h2 className="font-serif text-xl">GoSMS</h2>
          <p className="text-xs text-muted-foreground">
            Odesílání SMS přes <a href="https://app.gosms.eu/" target="_blank" rel="noopener noreferrer" className="underline">GoSMS</a>. Použitelné napříč Rašeliništěm — připomínky úkolů, notifikace klientům, ad-hoc SMS.
          </p>
        </div>
        {hasCredentials && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
            <Check className="w-3.5 h-3.5" /> připojeno
          </span>
        )}
      </header>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Credentials */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">API credentials</h3>
        <p className="text-xs text-muted-foreground">
          Najdeš v <a href="https://app.gosms.eu/selfservice/api/" target="_blank" rel="noopener noreferrer" className="underline">samoobsluze GoSMS</a> v sekci API.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            type="text"
            placeholder="client_id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
          />
          <Input
            type="password"
            placeholder={hasCredentials ? "client_secret (přepsat)" : "client_secret"}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={saveCredentials} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {hasCredentials ? "Přepsat & otestovat" : "Uložit & otestovat"}
          </Button>
          {saved && <span className="text-xs text-emerald-400 inline-flex items-center gap-1"><Check className="w-3 h-3" /> uloženo</span>}
          {hasCredentials && (
            <Button variant="ghost" onClick={disconnect}>
              <Trash2 className="w-4 h-4" /> Odpojit
            </Button>
          )}
        </div>
        {lastUsed && (
          <p className="text-xs text-muted-foreground">
            Naposledy použito: {lastUsed.toLocaleString("cs-CZ")}
            {lastErr && <span className="text-red-400"> · poslední chyba: {lastErr}</span>}
          </p>
        )}
      </section>

      {/* Organizace */}
      {hasCredentials && organization && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Organizace</h3>
            <Button variant="ghost" onClick={refreshOrganization} disabled={refreshing}>
              {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Načíst znovu
            </Button>
          </div>
          <div className="text-sm grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-muted-foreground">Aktuální kredit</div>
              <div className="font-mono">
                {organization.currentCredit.toFixed(2)} {organization.currency}
                {organization.invoicingType === "Postpaid" && (
                  <span className="text-xs text-muted-foreground ml-1">(postpaid)</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Načteno</div>
              <div className="text-xs">
                {organizationFetchedAt
                  ? new Date(organizationFetchedAt).toLocaleString("cs-CZ")
                  : "—"}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Default channel */}
      {hasCredentials && organization && organization.channels.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Výchozí kanál pro odesílání</h3>
          <p className="text-xs text-muted-foreground">
            Použije se vždy, když volající nezadá vlastní channel ID.
          </p>
          <select
            value={defaultChannel ?? ""}
            onChange={(e) => changeDefaultChannel(Number(e.target.value))}
            className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm"
          >
            {organization.channels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name} · {ch.sourceNumber} (ID {ch.id})
              </option>
            ))}
          </select>
        </section>
      )}

      {/* Webhooks */}
      {hasCredentials && webhookSecret && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Webhooky</h3>
            <Button variant="ghost" onClick={regenerateWebhookSecret}>
              <RotateCw className="w-4 h-4" /> Regenerovat secret
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Tyto URL nakonfiguruj v GoSMS samoobsluze (Webhooky → Doručenky / Odpovědi).
            Token v query stringu chrání proti zneužití — nesdílej.
          </p>

          {[
            { label: "Doručenky (delivery)", url: deliveryUrl, key: "delivery" },
            { label: "Odpovědi (reply)", url: replyUrl, key: "reply" },
          ].map((row) => (
            <div key={row.key} className="space-y-1">
              <div className="text-xs text-muted-foreground">{row.label}</div>
              <div className="flex gap-1">
                <code className="flex-1 text-xs bg-background/40 border border-border rounded px-2 py-1.5 font-mono break-all">
                  {row.url}
                </code>
                <Button
                  variant="ghost"
                  onClick={() => row.url && copyToClipboard(row.url, row.key)}
                  aria-label="Zkopírovat"
                >
                  {copiedKey === row.key ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
