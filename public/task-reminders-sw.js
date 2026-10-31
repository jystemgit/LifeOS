/* This worker never caches private pages or requests notification permission. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json(); }
    catch { throw new Error("Invalid LIFE OS push payload"); }
    if (!data || data.title !== "LIFE OS" || typeof data.body !== "string" ||
      typeof data.tag !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(data.tag) ||
      typeof data.url !== "string" || !/^\/tasks\?task=[A-Za-z0-9_%.-]+$/.test(data.url))
      throw new Error("Invalid LIFE OS push payload");
    await self.registration.showNotification("LIFE OS", {
      body: data.body, tag: data.tag, renotify: false,
      data: { url: data.url }, icon: "/AVlogo.jpeg",
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const path = event.notification.data?.url;
    if (typeof path !== "string" || !/^\/tasks\?task=[A-Za-z0-9_%.-]+$/.test(path))
      throw new Error("Invalid LIFE OS notification destination");
    const url = new URL(path, self.location.origin).href;
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = tabs.find((client) => new URL(client.url).origin === self.location.origin);
    if (tab) { await tab.navigate(url); await tab.focus(); }
    else await self.clients.openWindow(url);
  })());
});
