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

  const prevId = sessionStorage.getItem(ACTIVE_FIRM_ID_KEY)
  const nextId = firmId || null
  const nextName = firmName ?? null

  if (nextId) {
    sessionStorage.setItem(ACTIVE_FIRM_ID_KEY, nextId)
    if (nextName) {
      sessionStorage.setItem(ACTIVE_FIRM_NAME_KEY, nextName)
    }
  } else {
    sessionStorage.removeItem(ACTIVE_FIRM_ID_KEY)
    sessionStorage.removeItem(ACTIVE_FIRM_NAME_KEY)
  }

  // Skip redundant events when hydrate re-applies the same firm id.
  if (prevId === nextId && nextId !== null) {
    return
  }

  // Clear client context on firm change.
  const { clearActiveClient } = require("./clientSession")
  clearActiveClient()

  window.dispatchEvent(new CustomEvent("firmChanged", { detail: { firmId: nextId, firmName: nextName } }))
}

export function getActiveFirmName(): string | null {
  if (typeof window === "undefined") return null
  return sessionStorage.getItem(ACTIVE_FIRM_NAME_KEY)
}
