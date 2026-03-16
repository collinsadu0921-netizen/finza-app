/**
 * Firm Session Management
 * Manages the active firm selection for accounting firm users using sessionStorage
 * Provides firm context switching with automatic client context clearing
 */

const ACTIVE_FIRM_ID_KEY = 'finza_active_firm_id'
const ACTIVE_FIRM_NAME_KEY = 'finza_active_firm_name'

export function getActiveFirmId(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(ACTIVE_FIRM_ID_KEY)
}

export function setActiveFirmId(firmId: string | null, firmName?: string | null): void {
  if (typeof window === 'undefined') return
  
  if (firmId) {
    sessionStorage.setItem(ACTIVE_FIRM_ID_KEY, firmId)
    if (firmName) {
      sessionStorage.setItem(ACTIVE_FIRM_NAME_KEY, firmName)
    }
  } else {
    sessionStorage.removeItem(ACTIVE_FIRM_ID_KEY)
    sessionStorage.removeItem(ACTIVE_FIRM_NAME_KEY)
  }
  
  // Clear client context on firm change (hard isolation)
  const { clearActiveClient } = require('./firmClientSession')
  clearActiveClient()
  
  // Dispatch custom event to notify other components
  window.dispatchEvent(new CustomEvent('firmChanged', { detail: { firmId, firmName } }))
}

export function getActiveFirmName(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(ACTIVE_FIRM_NAME_KEY)
}
