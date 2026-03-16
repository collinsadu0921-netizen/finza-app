/**
 * Store Session Management
 * Manages the active store selection using sessionStorage
 */

const ACTIVE_STORE_KEY = 'finza_active_store_id'
const ACTIVE_STORE_NAME_KEY = 'finza_active_store_name'

export function getActiveStoreId(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(ACTIVE_STORE_KEY)
}

export function setActiveStoreId(storeId: string | null, storeName?: string | null): void {
  if (typeof window === 'undefined') return
  
  if (storeId === 'all') {
    // Store "all" as the string "all"
    sessionStorage.setItem(ACTIVE_STORE_KEY, 'all')
    sessionStorage.setItem(ACTIVE_STORE_NAME_KEY, 'All Stores')
  } else if (storeId) {
    sessionStorage.setItem(ACTIVE_STORE_KEY, storeId)
    if (storeName) {
      sessionStorage.setItem(ACTIVE_STORE_NAME_KEY, storeName)
    }
  } else {
    sessionStorage.removeItem(ACTIVE_STORE_KEY)
    sessionStorage.removeItem(ACTIVE_STORE_NAME_KEY)
  }
  
  // Dispatch custom event to notify other components
  window.dispatchEvent(new CustomEvent('storeChanged', { detail: { storeId, storeName } }))
}

export function getActiveStoreName(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(ACTIVE_STORE_NAME_KEY)
}

export function clearActiveStore(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(ACTIVE_STORE_KEY)
  sessionStorage.removeItem(ACTIVE_STORE_NAME_KEY)
  window.dispatchEvent(new CustomEvent('storeChanged', { detail: { storeId: null, storeName: null } }))
}



