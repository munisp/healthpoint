/* HealthPoint PWA service worker.
 * Privacy boundary: no API, authenticated, document, payment, or user-derived response
 * is cached. The only offline response is a static explanation page.
 */
const STATIC_CACHE = "healthpoint-static-v1";
const STATIC_ASSETS = ["/offline.html", "/manifest.webmanifest", "/icons/healthpoint.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== STATIC_CACHE).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API responses or routes that can return authenticated application state.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/dapr/") || url.pathname.startsWith("/metrics")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match("/offline.html")) || Response.error()));
    return;
  }

  // Cache only explicit static application assets; requests with credentials are never cached.
  const cacheableStaticAsset = url.pathname.startsWith("/assets/") || STATIC_ASSETS.includes(url.pathname);
  if (!cacheableStaticAsset || request.credentials !== "same-origin") return;
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        void caches.open(STATIC_CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
