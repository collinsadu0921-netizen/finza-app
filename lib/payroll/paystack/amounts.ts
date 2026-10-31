/**
 * GHS <-> pesewas conversion for Paystack.
 *
 * Paystack expects integer pesewas. Never use floating-point multiplication for
 * money; parse the decimal string into minor units.
 */

const GHS_AMOUNT_RE = /^(\d{1,12})(?:\.(\d{1,2}))?$/

/** Returns integer pesewas, or null when the amount is invalid or has sub-pesewa precision. */
export function ghsToPesewas(value: unknown): number | null {
  const raw = typeof value === "number" ? String(value) : String(value ?? "").trim()
  if (!GHS_AMOUNT_RE.test(raw)) return null
  const match = GHS_AMOUNT_RE.exec(raw)
  if (!match) return null
  const whole = Number(match[1])
  const fraction = (match[2] ?? "").padEnd(2, "0")
  if (!Number.isSafeInteger(whole) || whole > 9_000_000_000_000) return null
  const pesewas = whole * 100 + Number(fraction)
  return Number.isSafeInteger(pesewas) ? pesewas : null
}

/** Converts integer pesewas to a two-decimal GHS number. */
export function pesewasToGhs(pesewas: unknown): number {
  const n = Number(pesewas)
  if (!Number.isFinite(n)) return 0
  return Math.round(n) / 100
}

export function hasTwoDecimalGhsPrecision(value: unknown): boolean {
  const pesewas = ghsToPesewas(value)
  return pesewas != null
}

export function formatGhsAmount(value: unknown): string {
  const pesewas = ghsToPesewas(value)
  const amount = pesewas == null ? Number(value) : pesewasToGhs(pesewas)
  return `GHS ${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`
}
