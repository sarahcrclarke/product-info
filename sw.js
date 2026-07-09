/* Katie Loxton Product Intelligence — service worker (offline app shell) */
const CACHE = "kl-insight-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Always try network first for the data file so insights stay fresh; fall back to cache offline.
  if (url.pathname.endsWith("/data/products.json")) {
    e.respondWith(
      fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // App shell: cache first.
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
