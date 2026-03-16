/**
 * Cashier Session Management
 * Manages cashier PIN-based authentication state using sessionStorage
 */

const CASHIER_SESSION_KEY = 'finza_cashier_session'
const CASHIER_STORE_KEY = 'finza_cashier_store_id'
const CASHIER_STORE_NAME_KEY = 'finza_cashier_store_name'

export interface CashierSession {
  cashierId: string
  cashierName: string
  storeId: string
  businessId: string
}

export function getCashierSession(): CashierSession | null {
  if (typeof window === 'undefined') return null
  
  const sessionData = sessionStorage.getItem(CASHIER_SESSION_KEY)
  if (!sessionData) return null
  
  try {
    return JSON.parse(sessionData)
  } catch {
    return null
  }
}

export function setCashierSession(session: CashierSession): void {
  if (typeof window === 'undefined') return
  
  sessionStorage.setItem(CASHIER_SESSION_KEY, JSON.stringify(session))
  sessionStorage.setItem(CASHIER_STORE_KEY, session.storeId)
  
  // Dispatch custom event to notify other components
  window.dispatchEvent(new CustomEvent('cashierSessionChanged', { detail: session }))
}

export function clearCashierSession(): void {
  if (typeof window === 'undefined') return
  
  sessionStorage.removeItem(CASHIER_SESSION_KEY)
  sessionStorage.removeItem(CASHIER_STORE_KEY)
  sessionStorage.removeItem(CASHIER_STORE_NAME_KEY)
  
  window.dispatchEvent(new CustomEvent('cashierSessionChanged', { detail: null }))
}

export function isCashierAuthenticated(): boolean {
  return getCashierSession() !== null
}
