/**
 * Retail POS terminal cashier/kiosk lock helpers.
 *
 * Entering cashier mode (or switching cashiers) must not reveal the owner/admin
 * UI merely because a Supabase session cookie may still exist. Navigation lock
 * (sessionStorage) plus signing out the owner session closes that gap for the
 * Switch-cashier path. Admin return requires email reauthentication.
 */

import { clearCashierSession } from "@/lib/cashierSession"
import {
  activateRetailPosPinUrlIsolation,
  clearRetailPosPinUrlIsolation,
} from "@/lib/retail/posPinUrlIsolation"

export type SwitchCashierBlockReason = "non_empty_cart" | "payment_in_progress"

export type SwitchCashierGuardResult =
  | { ok: true }
  | { ok: false; reason: SwitchCashierBlockReason; message: string }

const NON_EMPTY_CART_MESSAGE =
  "Empty the cart or complete the sale before switching cashiers."

const PAYMENT_IN_PROGRESS_MESSAGE =
  "Finish or cancel payment before switching cashiers."

/**
 * Product rule (verified): no established non-empty-basket switch ownership.
 * Empty cart only; block otherwise without inventing park/attribution behaviour.
 */
export function canSwitchCashier(params: {
  cartItemCount: number
  processingPayment: boolean
  checkoutOpen: boolean
}): SwitchCashierGuardResult {
  if (params.processingPayment || params.checkoutOpen) {
    return { ok: false, reason: "payment_in_progress", message: PAYMENT_IN_PROGRESS_MESSAGE }
  }
  if (params.cartItemCount > 0) {
    return { ok: false, reason: "non_empty_cart", message: NON_EMPTY_CART_MESSAGE }
  }
  return { ok: true }
}

/**
 * End the current cashier PIN session and return to the lock screen.
 * Activates URL isolation before clearing the token so owner chrome cannot flash.
 * Signs out any underlying Supabase session so admin APIs are not callable.
 */
export async function switchToCashierPinLock(params: {
  signOut: () => Promise<unknown>
  navigateToPin: () => void
}): Promise<void> {
  activateRetailPosPinUrlIsolation()
  clearCashierSession()
  try {
    await params.signOut()
  } catch {
    /* still navigate to PIN lock */
  }
  params.navigateToPin()
}

/**
 * After a successful PIN login: keep terminal lock active and drop any owner
 * Supabase session so privileged APIs are not available under cashier mode.
 */
export async function afterCashierPinSuccessSecureTerminal(params: {
  signOut: () => Promise<unknown>
}): Promise<void> {
  activateRetailPosPinUrlIsolation()
  try {
    await params.signOut()
  } catch {
    /* cashier token already issued; continue to POS */
  }
}

/**
 * Explicit Admin access from the PIN lock screen: require email reauth.
 * Sign out first, then clear the kiosk lock, then send to login.
 */
export async function exitCashierLockForAdminReauth(params: {
  signOut: () => Promise<unknown>
  navigateToLogin: () => void
}): Promise<void> {
  clearCashierSession()
  try {
    await params.signOut()
  } catch {
    /* proceed to login */
  }
  clearRetailPosPinUrlIsolation()
  params.navigateToLogin()
}
