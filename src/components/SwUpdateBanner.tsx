import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Petr 2026-06-18 (fáze G) — Service Worker auto-update banner.
 *
 * Logika:
 *   1) Při loadu zaregistruj SW (idempotent — když je už, jen vrátí registration)
 *   2) Sleduj `updatefound` event → nová SW se instaluje na pozadí
 *   3) Při `SW_UPDATED` postMessage z aktivního SW (po deployi s novou VERSION)
 *      ukaž banner „Nová verze připravena, klikni pro restart"
 *   4) Klik → reload stránky (nová SW už přejala kontrolu, fresh assets přijdou)
 *
 * Renderuj v Shell.astro (jen pro přihlášené users) + případně v Base.astro
 * (pro public stránky se Studánka hosti).
 */
export default function SwUpdateBanner() {
  const [updateReady, setUpdateReady] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let mounted = true;

    // Registrace SW (idempotent)
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // Detekce nové verze v instalaci na pozadí
        reg.addEventListener("updatefound", () => {
          const newSw = reg.installing;
          if (!newSw) return;
          newSw.addEventListener("statechange", () => {
            // installed + existující controller = update čeká na activate
            if (newSw.state === "installed" && navigator.serviceWorker.controller) {
              if (mounted) setUpdateReady(true);
            }
          });
        });
      })
      .catch(() => {
        /* SW registration failed — ignore, app pokračuje bez auto-update */
      });

    // Poslechni messages z SW (postMessage při activate s novou verzí)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_UPDATED") {
        if (mounted) {
          setUpdateReady(true);
          setVersion(event.data.version ?? null);
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    // Reload pokud SW controller se změní (nová SW přejala kontrolu)
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      mounted = false;
      navigator.serviceWorker.removeEventListener("message", onMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  function restart() {
    // Pošli SKIP_WAITING aktivní (waiting) SW → ten zavolá self.skipWaiting()
    // → SW activate → controllerchange → window.location.reload (viz above)
    navigator.serviceWorker?.getRegistration().then((reg) => {
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      } else {
        // Fallback — jen reload (cache busts protože SW už updated)
        window.location.reload();
      }
    });
  }

  if (!updateReady) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-[200] rounded-lg border-2 border-[var(--c-signal)] bg-popover text-popover-foreground shadow-2xl p-4 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-start gap-3">
        <RefreshCw className="size-5 text-[var(--c-signal)] shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold text-sm">Nová verze připravena</div>
          {version && (
            <div className="text-[10px] font-mono text-muted-foreground mt-0.5 tracking-wider uppercase">
              ↳ {version}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Klikni pro restart, abys měl nejnovější design + funkce.
          </p>
          <button
            type="button"
            onClick={restart}
            className="mt-3 h-8 px-3 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Restartovat
          </button>
        </div>
      </div>
    </div>
  );
}
