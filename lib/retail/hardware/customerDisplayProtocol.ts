/**
 * Segmented numeric customer-facing amount display (POS pole LED).
 * Not a two-line alphanumeric VFD and not a second monitor.
 *
 * Conservative first physical-test candidate: ASCII digits and '.' only.
 * No ESC/POS init, line-select, CR, or LF.
 */

export const SEGMENTED_AMOUNT_MAX_CHARS = 8

export const SEGMENTED_AMOUNT_SERIAL = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
} as const

export type SegmentedAmountSerialOptions = typeof SEGMENTED_AMOUNT_SERIAL

export const CUSTOMER_DISPLAY_CHANGE_HOLD_MS = 4000

export type CustomerDisplayConnectionStatus = "disconnected" | "connected" | "error"

export type CustomerDisplaySaleSuccess = {
  cashReceived?: number | null
  changeGiven?: number | null
} | null

export type CustomerDisplayIntent =
  | { action: "none" }
  | { action: "write"; amount: number }
  | { action: "writeThenIdle"; amount: number; idleAfterMs: number }

const AMOUNT_CHARS = /^[0-9.]+$/

/** Format a money amount as digits + decimal point only, within 8 characters. */
export function formatSegmentedAmount(amount: number): string {
  const n = Number.isFinite(amount) ? Math.max(0, amount) : 0
  let body = n.toFixed(2)
  if (body.length > SEGMENTED_AMOUNT_MAX_CHARS) {
    body = Math.min(n, 99999.99).toFixed(2)
  }
  if (body.length > SEGMENTED_AMOUNT_MAX_CHARS) {
    body = "99999.99"
  }
  if (!AMOUNT_CHARS.test(body)) {
    return "0.00"
  }
  return body
}

export function amountFitsSegmentedDisplay(amount: number): boolean {
  const n = Number.isFinite(amount) ? Math.max(0, amount) : 0
  return n.toFixed(2).length <= SEGMENTED_AMOUNT_MAX_CHARS
}

export function buildSegmentedAmountBytes(amount: number): Uint8Array {
  const text = formatSegmentedAmount(amount)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0x7f
  }
  return bytes
}

export function segmentedAmountBytesToAscii(bytes: Uint8Array): string {
  return String.fromCharCode(...Array.from(bytes))
}

export function shouldWriteCustomerDisplay(status: CustomerDisplayConnectionStatus): boolean {
  return status === "connected"
}

export function resolveCustomerDisplayIntent(input: {
  status: CustomerDisplayConnectionStatus
  cartCount: number
  runningTotal: number
  checkoutOpen: boolean
  saleSuccess: CustomerDisplaySaleSuccess
  /** When true, automatic basket/total/change writes are paused for hardware diagnostics. */
  diagnosticMode?: boolean
}): CustomerDisplayIntent {
  if (input.diagnosticMode) {
    return { action: "none" }
  }
  if (!shouldWriteCustomerDisplay(input.status)) {
    return { action: "none" }
  }

  if (input.saleSuccess) {
    const tendered = Number(input.saleSuccess.cashReceived ?? 0)
    const change = Number(input.saleSuccess.changeGiven ?? 0)
    if (tendered > 0 && Number.isFinite(change) && change >= 0 && amountFitsSegmentedDisplay(change)) {
      return {
        action: "writeThenIdle",
        amount: change,
        idleAfterMs: CUSTOMER_DISPLAY_CHANGE_HOLD_MS,
      }
    }
    return { action: "write", amount: 0 }
  }

  if (input.checkoutOpen) {
    return { action: "write", amount: input.runningTotal }
  }

  if (input.cartCount <= 0) {
    return { action: "write", amount: 0 }
  }

  return { action: "write", amount: input.runningTotal }
}
