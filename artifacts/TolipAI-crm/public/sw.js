// Digor CRM — Service Worker
// Strategy: cache-first for static assets, network-first for navigation & API.

const CACHE_NAME = "digor-crm-v1";

// Static asset extensions to cache
const CACHE_EXTS = [".js", ".css", ".png", ".svg", ".ico", ".woff2", ".woff", ".ttf"];

function isStaticAsset(url) {
  return CACHE_EXTS.some(ext => url.pathname.endsWith(ext));
}

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls — always go to network
  if (isApiRequest(url)) return;

  // Cache-first for static assets (JS, CSS, fonts, images)
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first for navigation (HTML pages)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/crm/").then((cached) => cached || new Response("Offline", { status: 503 }))
      )
    );
    return;
  }
});
