const CACHE_NAME = "listo-shell-v10";
const ASSET_VERSION = "0.2.4";
const APP_SHELL = [
  "./",
  "./index.html",
  `./styles.css?v=${ASSET_VERSION}`,
  `./task-core.js?v=${ASSET_VERSION}`,
  `./todoist-import.js?v=${ASSET_VERSION}`,
  `./script.js?v=${ASSET_VERSION}`,
  `./sync-core.js?v=${ASSET_VERSION}`,
  `./sync-config.js?v=${ASSET_VERSION}`,
  `./sync.js?v=${ASSET_VERSION}`,
  `./pwa.js?v=${ASSET_VERSION}`,
  "./manifest.webmanifest",
  "./assets/icons/favicon-32.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/tempo-icon-192.png",
  "./assets/icons/tempo-icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
    const openClients = await self.clients.matchAll({ type: "window" });
    await Promise.all(openClients.map((client) => client.navigate(client.url)));
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const freshRequest = new Request(event.request, { cache: "no-cache" });
  event.respondWith(fetch(freshRequest).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))));
});
