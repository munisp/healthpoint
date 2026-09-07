// HealthPoint IDR — Service Worker
// Provides offline fallback, static asset caching, and an update lifecycle.
//
// VERSIONING: SW_VERSION is embedded in CACHE_NAME. Bump it on every release
// that changes precached assets or caching behavior (e.g. -1 → -2) so the
// activate handler purges stale caches and clients pick up the new version.
const SW_VERSION = "2026-09-05-1";
const CACHE_NAME = `healthpoint-idr-${SW_VERSION}`;
const OFFLINE_URL = "/offline.html";

// Critical assets precached at install time.
const PRECACHE_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/icons/icon-192.png",
];

// Same-origin static asset extensions eligible for stale-while-revalidate.
const STATIC_ASSET_EXTENSIONS = [".js", ".css", ".png", ".svg", ".woff2"];

// Install: precache critical assets, then activate immediately.
// A single missing asset (e.g. an icon not yet generated) must never block
// activation: fall back to precaching the offline essentials individually.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        try {
          await cache.addAll(PRECACHE_ASSETS);
        } catch (err) {
          console.warn(
            "Precache addAll failed; caching essentials individually:",
            err
          );
          for (const url of ["/", OFFLINE_URL]) {
            try {
              await cache.add(url);
            } catch (individualErr) {
              console.warn(`Precache failed for ${url}:`, individualErr);
            }
          }
        }
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: delete caches from older versions, then take control of clients.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin GET requests; let everything else hit the network.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API calls: network-only (never serve cached tRPC/API responses).
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests: network-first, then cache, then offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (STATIC_ASSET_EXTENSIONS.some((ext) => url.pathname.endsWith(ext))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }
});
