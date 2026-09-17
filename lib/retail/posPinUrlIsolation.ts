/**
 * Terminal cashier/kiosk navigation lock for the Retail POS tab.
 * While active, Supabase users (including owner/admin/manager) must not reach
 * /retail/admin/* or other back-office routes via the address bar or history.
 * Cleared only after explicit Admin access (email reauth) or TTL — not on PIN success.
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
