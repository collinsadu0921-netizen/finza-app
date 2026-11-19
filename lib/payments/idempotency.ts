export type IdempotentPaymentRequest = {
  invoice_id?: string | null
  amount?: number | string | null
  date?: string | null
  method?: string | null
  wht_amount?: number | string | null
  settlement_fx_rate?: number | string | null
  reference?: string | null
}

export type StoredPaymentForIdempotency = {
  invoice_id?: string | null
  amount?: number | string | null
  date?: string | null
  method?: string | null
  wht_amount?: number | string | null
  settlement_fx_rate?: number | string | null
  reference?: string | null
}

const numberOrZero = (value: unknown) => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0
}

const dateOnly = (value: unknown) => String(value ?? "").slice(0, 10)

/**
 * A repeated idempotency key may only replay the original request. Same key
 * with a different invoice, amount, date, method, WHT, FX rate or reference is
 * a conflict and must not return or overwrite the original payment.
 */
export function paymentMatchesIdempotentRequest(
  stored: StoredPaymentForIdempotency,
  request: IdempotentPaymentRequest
): boolean {
  return (
    String(stored.invoice_id ?? "") === String(request.invoice_id ?? "") &&
    numberOrZero(stored.amount) === numberOrZero(request.amount) &&
    dateOnly(stored.date) === dateOnly(request.date) &&
    String(stored.method ?? "") === String(request.method ?? "") &&
    numberOrZero(stored.wht_amount) === numberOrZero(request.wht_amount) &&
    numberOrZero(stored.settlement_fx_rate) === numberOrZero(request.settlement_fx_rate) &&
    String(stored.reference ?? "") === String(request.reference ?? "")
  )
}
