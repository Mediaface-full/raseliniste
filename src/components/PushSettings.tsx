import { useEffect, useState } from "react";
import { Loader2, Bell, Smartphone, Trash2, Send, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface SubInfo {
  id: string;
  label: string | null;
  endpointTail: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastError: string | null;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function PushSettings() {
  const [supported, setSupported] = useState<boolean>(true);
  const [permission, setPermission] = useState<NotificationPermission | "loading">("loading");
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [subs, setSubs] = useState<SubInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupported(false);
      setLoading(false);
      return;
    }
    setPermission(Notification.permission);
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/push/subscribe");
      const data = await res.json();
      if (res.ok) {
        setVapidPublicKey(data.vapidPublicKey);
        setSubs(data.subscriptions);
      }
    } finally {
      setLoading(false);
    }
  }

  async function enable() {
    setErr(null);
    setMsg(null);
    if (!vapidPublicKey) {
      setErr("Server nemá nastavené VAPID klíče. Doplň VAPID_* do .env.");
      return;
    }
    setBusy(true);
    try {
      // 1) Registrace SW
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

      // 2) Permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setErr("Notifikace nebyly povoleny.");
        return;
      }

      // 3) Subscribe
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const subJson = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const autoLabel = label.trim() || guessDeviceLabel();

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          label: autoLabel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Subscribe na server selhal.");
        return;
      }
      setMsg(`✓ Zařízení „${autoLabel}" zaregistrované.`);
      setLabel("");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/push/subscribe", { method: "PUT" });
      const data = await res.json();
      if (!data.ok) {
        setErr(`Test selhal: sent=${data.sent} failed=${data.failed} ${data.errors?.join(" · ") ?? ""}`);
        return;
      }
      setMsg(`✓ Test odeslán na ${data.sent} zařízení. Zkontroluj telefon/mobil.`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Smazat tohle zařízení? Notifikace na něj se přestanou posílat.")) return;
    const res = await fetch(`/api/push/subscribe?id=${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  if (loading) {
    return <div className="glass rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Načítám…
    </div>;
  }

  if (!supported) {
    return <div className="glass rounded-xl p-6 text-sm">
      Tento prohlížeč nepodporuje web push. Zkus v Safari (iOS 16.4+ jako PWA na ploše) nebo Chrome.
    </div>;
  }

  const hasSub = subs.length > 0;
  const canEnable = permission !== "denied";

  return (
    <div className="space-y-4 max-w-xl">
      {/* Status + setup */}
      <div className="glass-strong rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="size-5 text-[var(--tint-rose)]" />
          <div className="font-serif text-base">Push notifikace</div>
          <span className={`ml-auto text-xs font-mono ${permission === "granted" ? "text-[var(--tint-sage)]" : "text-muted-foreground"}`}>
            {permission === "granted" ? "povoleno" : permission === "denied" ? "zakázáno" : "neaktivní"}
          </span>
        </div>

        {permission === "denied" && (
          <div className="text-sm text-destructive">
            Notifikace jsou v prohlížeči zakázané. Otevři nastavení prohlížeče → notifikace pro tuto stránku → povolit. Pak refresh.
          </div>
        )}

        {canEnable && (
          <>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Název tohoto zařízení (volitelné)
              </label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={guessDeviceLabel()}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={enable} disabled={busy}>
                {busy ? <><Loader2 className="animate-spin" /> Pracuji…</> : <><Bell /> Povolit & registrovat</>}
              </Button>
              {hasSub && (
                <Button variant="outline" onClick={test} disabled={busy}>
                  <Send /> Poslat test
                </Button>
              )}
            </div>
          </>
        )}

        {err && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{err}</div>}
        {msg && <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2">{msg}</div>}
      </div>

      {/* iOS specifický návod */}
      <div className="glass rounded-xl p-4 text-sm space-y-2">
        <div className="font-serif text-base flex items-center gap-2">
          <Smartphone className="size-4" /> iPhone — pouze přes PWA
        </div>
        <p class="text-muted-foreground">
          Apple dovoluje web push <strong>jen pokud je stránka přidaná na plochu jako appka</strong>.
          Bez toho v Safari push NEFUNGUJE.
        </p>
        <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
          <li>Otevři tuto stránku v <strong>Safari</strong> (ne Chrome)</li>
          <li>Sdílet ⬆️ → <strong>Přidat na plochu</strong></li>
          <li>Otevři appku <strong>z plochy</strong> (ne ze Safari!)</li>
          <li>Vrať se sem do nastavení push → klikni <strong>Povolit</strong> nahoře</li>
          <li>iOS se zeptá na permission → <strong>Allow</strong></li>
          <li>Klikni <strong>Poslat test</strong> → push by měl přijít</li>
        </ol>
      </div>

      {/* Seznam zaregistrovaných zařízení */}
      {hasSub && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
            Aktivní zařízení ({subs.length})
          </div>
          {subs.map((s) => (
            <div key={s.id} className="glass rounded-xl p-3 flex items-center gap-3">
              <Smartphone className="size-4 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{s.label ?? "(bez názvu)"}</div>
                <div className="text-[10px] font-mono text-muted-foreground/70">
                  …{s.endpointTail}
                </div>
                {s.lastError && (
                  <div className="text-[11px] text-destructive flex items-center gap-1 mt-0.5">
                    <AlertTriangle className="size-3" /> {s.lastError.slice(0, 80)}
                  </div>
                )}
                {s.lastUsedAt && !s.lastError && (
                  <div className="text-[10px] font-mono text-[var(--tint-sage)] flex items-center gap-1 mt-0.5">
                    <CheckCircle2 className="size-3" /> naposledy {new Date(s.lastUsedAt).toLocaleString("cs-CZ")}
                  </div>
                )}
              </div>
              <button
                onClick={() => remove(s.id)}
                className="p-1.5 text-muted-foreground hover:text-destructive"
                title="Smazat"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function guessDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Zařízení";
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Zařízení";
}
