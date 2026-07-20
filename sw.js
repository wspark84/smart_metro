self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "BusWakeUp alarm" };
  }

  const title = String(payload.title || "BusWakeUp commute alarm");
  const options = {
    body: String(payload.body || "Your commute alarm needs attention."),
    tag: String(payload.tag || "buswakeup-alarm"),
    renotify: Boolean(payload.renotify),
    requireInteraction: Boolean(payload.requireInteraction),
    data: payload.data && typeof payload.data === "object" ? payload.data : { url: "/#/home" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(String(event.notification.data?.url || "/#/home"), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url === targetUrl);
      return existing ? existing.focus() : self.clients.openWindow(targetUrl);
    }),
  );
});
