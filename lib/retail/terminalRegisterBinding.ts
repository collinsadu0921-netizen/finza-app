/**
 * One register per device per store (Lightspeed-style: terminal = till).
 * Same binding is used whether staff (Supabase) or cashier (PIN) is signed in — no separate "modes" in UX.
 *
 * Canonical key: `finza_retail_terminal_register:{businessId}:{storeId}`
 * Migrates legacy `:staff` / `:cashier` keys into the canonical key on read.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function canonicalKey(businessId: string, storeId: string): string {
  return `finza_retail_terminal_register:${businessId}:${storeId}`
}

function splitModeKey(businessId: string, storeId: string, suffix: "staff" | "cashier"): string {
  return `${canonicalKey(businessId, storeId)}:${suffix}`
}

function readRawRegisterId(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(key)?.trim()
    if (!raw || !UUID_RE.test(raw)) return null
    return raw
  } catch {
    return null
  }
}

/** Read binding and consolidate old per-mode keys into the canonical key. */
export function getTerminalRegisterId(businessId: string, storeId: string): string | null {
  const canon = canonicalKey(businessId, storeId)
  const primary = readRawRegisterId(canon)
  if (primary) return primary

  const fromStaff = readRawRegisterId(splitModeKey(businessId, storeId, "staff"))
  const fromCashier = readRawRegisterId(splitModeKey(businessId, storeId, "cashier"))
  const migrated = fromStaff || fromCashier
  if (migrated) {
    try {
      localStorage.setItem(canon, migrated)
      localStorage.removeItem(splitModeKey(businessId, storeId, "staff"))
      localStorage.removeItem(splitModeKey(businessId, storeId, "cashier"))
    } catch {
      /* ignore */
    }
    return migrated
  }

  return null
}

export function setTerminalRegisterId(businessId: string, storeId: string, registerId: string): void {
  if (typeof window === "undefined") return
  const canon = canonicalKey(businessId, storeId)
  try {
    localStorage.setItem(canon, registerId)
    localStorage.removeItem(splitModeKey(businessId, storeId, "staff"))
    localStorage.removeItem(splitModeKey(businessId, storeId, "cashier"))
    window.dispatchEvent(new CustomEvent("terminalRegisterBindingChanged", { detail: { businessId, storeId } }))
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearTerminalRegisterId(businessId: string, storeId: string): void {
  if (typeof window === "undefined") return
  try {
    const canon = canonicalKey(businessId, storeId)
    localStorage.removeItem(canon)
    localStorage.removeItem(splitModeKey(businessId, storeId, "staff"))
    localStorage.removeItem(splitModeKey(businessId, storeId, "cashier"))
    window.dispatchEvent(new CustomEvent("terminalRegisterBindingChanged", { detail: { businessId, storeId } }))
  } catch {
    /* ignore */
  }
}

export function canManageTerminalBinding(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "manager"
}
