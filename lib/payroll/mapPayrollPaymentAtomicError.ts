export type PayrollPaymentErrorPayload = {
  error: string
  code: string
  status: number
  [key: string]: unknown
}

function tryParseDetail(detail: unknown): Record<string, unknown> | null {
  if (detail == null) return null
  if (typeof detail === "object" && !Array.isArray(detail)) {
    return detail as Record<string, unknown>
  }
  const s = String(detail)
  try {
    const parsed = JSON.parse(s)
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>
  } catch {
    /* ignore */
  }
  return null
}

const CODE_PATTERN =
  /\b(PAYROLL_PAYMENT_[A-Z0-9_]+|PAYROLL_RUN_[A-Z0-9_]+|PAYROLL_BATCH_ITEM_[A-Z0-9_]+)\b/

function extractCode(message: string, detail: Record<string, unknown> | null): string | null {
  if (detail?.code && typeof detail.code === "string") return detail.code
  const fromMsg = message.match(CODE_PATTERN)
  return fromMsg?.[1] ?? null
}

export function mapPayrollPaymentAtomicError(err: {
  message?: string | null
  details?: string | null
  hint?: string | null
} | null): PayrollPaymentErrorPayload {
  const message = String(err?.message || err?.details || "Payroll payment failed")
  const detail = tryParseDetail(err?.details) || tryParseDetail(err?.hint)
  const code = extractCode(message, detail) || "PAYROLL_PAYMENT_FAILED"

  const base: PayrollPaymentErrorPayload = {
    error: message,
    code,
    status: 400,
  }

  switch (code) {
    case "PAYROLL_PAYMENT_PERMISSION_DENIED":
      base.status = 403
      break
    case "PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT":
    case "PAYROLL_PAYMENT_EXCEEDS_OUTSTANDING":
    case "PAYROLL_PAYMENT_OBLIGATION_MISMATCH":
    case "PAYROLL_PAYMENT_RUN_NOT_PAYABLE":
    case "PAYROLL_PAYMENT_BATCH_LINK_CONFLICT":
    case "PAYROLL_PAYMENT_BATCH_AMOUNT_MISMATCH":
    case "PAYROLL_PAYMENT_BATCH_IDENTITY_MISMATCH":
    case "PAYROLL_BATCH_PAYMENT_RECONCILIATION_FAILED":
    case "PAYROLL_RUN_IMMUTABLE":
    case "PAYROLL_RUN_INVALID_STATUS_TRANSITION":
    case "PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED":
      base.status = 409
      break
    case "PAYROLL_PAYMENT_IDEMPOTENCY_KEY_REQUIRED":
      base.status = 400
      break
    case "PAYROLL_ACTOR_IDENTITY_MISMATCH":
      base.status = 403
      break
    case "PAYROLL_PAYMENT_PERIOD_CLOSED":
      base.status = 409
      break
    case "PAYROLL_PAYMENT_INVALID_ACCOUNT":
    case "PAYROLL_PAYMENT_INVALID_INPUT":
      base.status = 400
      break
    default:
      base.status = 400
  }

  return base
}
