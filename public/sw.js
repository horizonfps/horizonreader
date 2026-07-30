// Cache-first service worker for cover and page images.
// Bump VERSION to force old clients onto a fresh cache.
const VERSION = "v1";
const CACHE = `hr-img-${VERSION}`;
const MAX_ENTRIES = 900;

const CACHEABLE_PATHS = new Set(["/api/cover", "/api/image"]);

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("hr-img-") && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!CACHEABLE_PATHS.has(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const res = await fetch(request);
        if (res.status === 200 && res.type === "basic" && !res.redirected) {
          const copy = res.clone();
          event.waitUntil(
            (async () => {
              await cache.put(request, copy);
              await trimCache(cache);
            })(),
          );
        }
        return res;
      } catch (err) {
        const fallback = await cache.match(request);
        if (fallback) return fallback;
        throw err;
      }
    })(),
  );
});
