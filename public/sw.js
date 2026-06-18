/* Service Worker pro web push notifikace + auto-update (Petr 2026-06-18).
   Registruje se z klienta při zapnutí push (PushSettings.tsx).
   iOS PWA vyžaduje aby SW byl na same-origin a v root scope.

   Cache verze: při změně VERSION se po deployi nová SW aktivuje hned
   (skipWaiting + clients.claim) a pošle klientům zprávu "SW_UPDATED" →
   ClientReloader.tsx ukáže banner „Nová verze připravena, klikni pro restart". */

const VERSION = "gide-on-v1";
const RUNTIME_CACHE = `raseliniste-${VERSION}`;

self.addEventListener("install", (event) => {
  // Aktivuj se hned, neček na reload tabu
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // Smaž staré cache verze (jen ty co mají náš prefix, žádné cross-app)
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("raseliniste-") && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      ),
      // Převezmi kontrolu nad všemi otevřenými klienty bez reload
      self.clients.claim(),
    ]).then(() => {
      // Notifikuj všechny klienty že je nová verze aktivní
      return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "SW_UPDATED", version: VERSION });
        }
      });
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "Rašeliniště", body: "" };
  }

  const title = payload.title || "Rašeliniště";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/apple-touch-icon.png",
    badge: payload.badge || "/apple-touch-icon.png",
    tag: payload.tag || undefined,
    data: { url: payload.url || "/" },
    requireInteraction: false,
    silent: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Pokud je už otevřená naše stránka, focusni ji + naviguj
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) {
            try {
              client.navigate(url);
              return;
            } catch (e) {
              /* ignore */
            }
          }
          return;
        }
      }
      // Jinak otevři nové okno
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    }),
  );
});

// Listener pro manuální skip-waiting z klienta (button „Restartovat appku")
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
