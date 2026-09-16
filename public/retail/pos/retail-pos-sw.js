/* eslint-disable no-undef */
/**
 * Retail POS scoped service worker.
 * - Caches successful navigations under /retail/pos for shell reload only.
 * - Never caches /api, auth, or hardware configuration responses.
 * - Does not claim offline sales support.
 * - skipWaiting + clients.claim so releases activate promptly.
 */
const CACHE_NAME = "finza-retail-pos-nav-v2"

function isSensitiveUrl(url) {
  const path = url.pathname
  if (path.startsWith("/api/")) return true
  if (path.includes("auth")) return true
  if (path.includes("customer-display")) return true
  if (path.includes("pin-login")) return true
  return false
}

self.addEventListener("install", (event) => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k.startsWith("finza-retail-pos-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return

  try {
    const url = new URL(req.url)
    if (url.origin !== self.location.origin) return
    if (isSensitiveUrl(url)) return

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
          .catch(async () => {
            const cached = await caches.match(req)
            if (cached) return cached
            return new Response(
              "<!doctype html><title>Offline</title><body style=\"font-family:system-ui;padding:2rem\"><h1>Finza Retail is offline</h1><p>Sales cannot be taken without a network connection. Reconnect and reload.</p></body>",
              { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
            )
          })
      )
    }
  } catch {
    /* ignore */
  }
})
