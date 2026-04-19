"use client"

import { useEffect } from "react"

/**
 * Registers the Retail POS–scoped service worker and (best-effort) activates the PWA manifest
 * linked from `app/retail/pos/layout.tsx` metadata. Does not affect other workspaces.
 */
export default function RetailPosPwaRoot() {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return

    const swUrl = "/retail/pos/retail-pos-sw.js"
    const register = async () => {
      try {
        await navigator.serviceWorker.register(swUrl, { scope: "/retail/pos/" })
      } catch (e) {
        console.warn("[Retail POS SW] registration failed:", e)
      }
    }

    void register()
  }, [])

  return null
}
