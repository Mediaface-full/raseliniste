/* Service Worker pro web push notifikace.
   Registruje se z klienta při zapnutí push (PushSettings.tsx).
   iOS PWA vyžaduje aby SW byl na same-origin a v root scope. */

self.addEventListener("install", (event) => {
  // Aktivuj se hned, neček na reload tabu
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Převezmi kontrolu nad všemi otevřenými klienty bez reload
  event.waitUntil(self.clients.claim());
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
