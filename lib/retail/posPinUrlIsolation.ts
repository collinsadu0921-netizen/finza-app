/**
 * While the cashier PIN screen is shown, Supabase users (e.g. owner on a shared register)
 * must not be able to jump to /retail/admin/* via the address bar. Cleared after successful
 * PIN login, explicit exit, or TTL.
 */
const STORAGE_KEY = "finza_retail_pos_pin_nav_lock_until"
const TTL_MS = 4 * 60 * 60 * 1000

function getSessionStorage(): Storage | null {
  try {
    if (typeof globalThis === "undefined") return null
    const s = (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage
    return s ?? null
  } catch {
    return null
  }
}

export function activateRetailPosPinUrlIsolation(): void {
  const s = getSessionStorage()
  if (!s) return
  s.setItem(STORAGE_KEY, String(Date.now() + TTL_MS))
}

export function clearRetailPosPinUrlIsolation(): void {
  const s = getSessionStorage()
  if (!s) return
  s.removeItem(STORAGE_KEY)
}

export function isRetailPosPinUrlIsolationActive(): boolean {
  const s = getSessionStorage()
  if (!s) return false
  const raw = s.getItem(STORAGE_KEY)
  if (!raw) return false
  const until = parseInt(raw, 10)
  if (Number.isNaN(until) || Date.now() > until) {
    s.removeItem(STORAGE_KEY)
    return false
  }
  return true
}
