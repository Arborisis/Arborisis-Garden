const CACHE = "arborisis-v2";
const ASSETS = ["/", "/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // Ne pas cacher les APIs
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request).then((res) => res || caches.match("/")))
  );
});

// ─── Push Notifications ───────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Arborisis", body: event.data.text(), icon: "/icon.svg" };
  }

  const { title = "Arborisis", body = "", icon = "/icon.svg", badge = "/icon.svg", tag, data = {}, urgency = "normal" } = payload;

  const options = {
    body,
    icon,
    badge,
    tag: tag || "arborisis-notif",
    data,
    vibrate: urgency === "urgent" ? [200, 100, 200, 100, 200] : [100, 50, 100],
    requireInteraction: urgency === "urgent",
    silent: false,
    actions: data.plantId
      ? [
          { action: "open", title: "Voir la plante" },
          { action: "dismiss", title: "Ignorer" }
        ]
      : []
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const plantId = event.notification.data?.plantId;
  const url = plantId ? `/?plantId=${plantId}&tab=dashboard` : "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => c.url.includes(self.location.origin));
        if (existing) {
          existing.focus();
          existing.postMessage({ type: "NOTIFICATION_CLICK", url, plantId });
          return;
        }
        return self.clients.openWindow(url);
      })
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options).then((sub) =>
      fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON())
      })
    )
  );
});
