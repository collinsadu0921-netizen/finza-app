/**
 * Session-boundary invalidation for sharedJsonGet.
 *
 * Uses the existing Supabase auth lifecycle. Does not invent a parallel session store.
 *
 * Semantics:
 * - undefined (uninitialized) → first known id: record only, do not clear
 * - A → A: do not clear
 * - A → null: clear
 * - A → B: clear
 * - logout: always clear, even if identity was not hydrated yet
 */
import { clearSharedJsonGet } from "@/lib/client/sharedJsonGet"

let lastUserId: string | null | undefined = undefined
let subscribed = false

export function syncSharedJsonGetAuthIdentity(nextUserId: string | null): { cleared: boolean } {
  if (lastUserId === undefined) {
    lastUserId = nextUserId
    return { cleared: false }
  }
  if (lastUserId === nextUserId) {
    return { cleared: false }
  }
  clearSharedJsonGet()
  lastUserId = nextUserId
  return { cleared: true }
}

/** Call before signOut. Safe even if signOut later fails. */
export function beginSharedJsonGetAuthLogout(): void {
  clearSharedJsonGet()
  lastUserId = null
}

export function resetSharedJsonGetAuthBoundaryForTests(): void {
  lastUserId = undefined
  subscribed = false
}

export function ensureSharedJsonGetAuthBoundary(): void {
  if (subscribed || typeof window === "undefined") return
  subscribed = true
  void import("@/lib/supabaseClient").then(({ supabase }) => {
    supabase.auth.onAuthStateChange((_event, session) => {
      syncSharedJsonGetAuthIdentity(session?.user?.id ?? null)
    })
  })
}
