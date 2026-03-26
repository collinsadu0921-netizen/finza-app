/**
 * Firm Session Management
 * Manages active firm selection with sessionStorage.
 */

const ACTIVE_FIRM_ID_KEY = "finza_active_firm_id"
const ACTIVE_FIRM_NAME_KEY = "finza_active_firm_name"

export function getActiveFirmId(): string | null {
  if (typeof window === "undefined") return null
  return sessionStorage.getItem(ACTIVE_FIRM_ID_KEY)
}

export function setActiveFirmId(firmId: string | null, firmName?: string | null): void {
  if (typeof window === "undefined") return

  if (firmId) {
    sessionStorage.setItem(ACTIVE_FIRM_ID_KEY, firmId)
    if (firmName) {
      sessionStorage.setItem(ACTIVE_FIRM_NAME_KEY, firmName)
    }
  } else {
    sessionStorage.removeItem(ACTIVE_FIRM_ID_KEY)
    sessionStorage.removeItem(ACTIVE_FIRM_NAME_KEY)
  }

  // Clear client context on firm change.
  const { clearActiveClient } = require("./clientSession")
  clearActiveClient()

  window.dispatchEvent(new CustomEvent("firmChanged", { detail: { firmId, firmName } }))
}

export function getActiveFirmName(): string | null {
  if (typeof window === "undefined") return null
  return sessionStorage.getItem(ACTIVE_FIRM_NAME_KEY)
}
