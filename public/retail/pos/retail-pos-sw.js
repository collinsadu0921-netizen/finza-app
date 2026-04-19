/* eslint-disable no-undef */
/**
 * Retail POS scoped service worker (Phase 1).
 * Caches successful navigations under /retail/pos so the shell can reload offline
 * after at least one online visit (browser HTTP cache still holds most /_next assets).
 */
const CACHE_NAME = "finza-retail-pos-nav-v1"

self.addEventListener("install", (event) => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return

  try {
    const url = new URL(req.url)
    if (req.mode === "navigate" && url.pathname.startsWith("/retail/pos")) {
      event.respondWith(
        fetch(req)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone()
              void caches.open(CACHE_NAME).then((cache) => cache.put(req, copy))
            }
            return response
          })
          .catch(() => caches.match(req))
      )
    }
  } catch {
    /* ignore */
  }
})
