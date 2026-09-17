/**
 * Retail POS terminal cashier/kiosk lock helpers (Option B).
 *
 * Manager Supabase session may remain underneath. Security boundary is the
 * HttpOnly terminal-lock cookie + client PIN isolation + cashier token scope.
 * Do NOT sign out the manager until every cashier dependency has an independent
 * credential (that is not true today).
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

export type TerminalLockActivateBody = {
  businessId: string
  storeId: string
  registerId?: string | null
}

/** Best-effort: set/refresh HttpOnly terminal lock while manager session exists. */
export async function activatePosTerminalLockCookie(
  body: TerminalLockActivateBody
): Promise<boolean> {
  try {
    const res = await fetch("/api/retail/pos/terminal-lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * End the current cashier PIN session and return to the lock screen.
 * Keeps manager session and terminal-lock cookie. Never navigates to admin.
 */
export async function switchToCashierPinLock(params: {
  navigateToPin: () => void
  /** Optional refresh of server lock while manager session still present */
  refreshLock?: TerminalLockActivateBody | null
}): Promise<void> {
  activateRetailPosPinUrlIsolation()
  clearCashierSession()
  if (params.refreshLock?.businessId && params.refreshLock.storeId) {
    await activatePosTerminalLockCookie(params.refreshLock)
  }
  params.navigateToPin()
}

/**
 * After successful PIN: keep client isolation + activate server terminal lock.
 * Does not sign out the manager session (cashier APIs still need it for several flows;
 * privileged APIs are blocked by the lock cookie).
 */
export async function afterCashierPinSuccessSecureTerminal(params: {
  lock: TerminalLockActivateBody
}): Promise<void> {
  activateRetailPosPinUrlIsolation()
  await activatePosTerminalLockCookie(params.lock)
}

/**
 * Explicit Admin access: reauthenticate via email/password, then clear lock cookie
 * and client isolation. On failure, remain locked.
 */
export async function exitCashierLockForAdminReauth(params: {
  email: string
  password: string
  navigateToAdmin: () => void
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/retail/pos/terminal-lock", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email: params.email, password: params.password }),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) {
      return { ok: false, error: data.error || "Could not unlock terminal" }
    }
    clearCashierSession()
    clearRetailPosPinUrlIsolation()
    params.navigateToAdmin()
    return { ok: true }
  } catch {
    return { ok: false, error: "Could not unlock terminal" }
  }
}
