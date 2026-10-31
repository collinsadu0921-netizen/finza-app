"use client"

import { useEffect } from "react"
import {
  getSelectedBusinessId,
  setSelectedBusinessId,
  WORKSPACE_STORAGE_KEY,
} from "@/lib/business"

let fetchPatched = false

/**
 * Keeps the server-validated active-business cookie and the per-tab workspace
 * header in sync with the browser selection. Mounted once at the app root.
 */
export default function WorkspaceContextSync() {
  useEffect(() => {
    const selected = getSelectedBusinessId()
    if (selected) {
      // Re-validates membership and refreshes the server cookie after login or
      // when an existing localStorage selection predates the cookie mechanism.
      setSelectedBusinessId(selected)
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === WORKSPACE_STORAGE_KEY && event.newValue) {
        // Another tab switched workspace. Reload this tab into the same
        // server-validated context instead of leaving stale tenant data on screen.
        window.location.reload()
      }
    }
    window.addEventListener("storage", onStorage)

    if (fetchPatched || typeof window === "undefined") {
      return () => window.removeEventListener("storage", onStorage)
    }
    fetchPatched = true
    const originalFetch = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        const url = new URL(rawUrl, window.location.href)
        if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
          const businessId = getSelectedBusinessId()
          if (businessId) {
            const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
            headers.set("x-finza-business-id", businessId)
            return originalFetch(input, { ...init, headers })
          }
        }
      } catch {
        // Fall through to the original request.
      }
      return originalFetch(input, init)
    }

    return () => {
      // Keep the patched fetch for the app lifetime; restoring it would make
      // the header disappear on fast-refresh remounts.
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  return null
}
