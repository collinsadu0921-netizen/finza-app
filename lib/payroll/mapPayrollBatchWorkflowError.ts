export type PayrollWorkflowErrorPayload = {
  error: string
  code: string
  status: number
  [key: string]: unknown
}

const CODE_PATTERN = /\b(PAYROLL_[A-Z0-9_]+)\b/

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

function extractCode(message: string, detail: Record<string, unknown> | null): string | null {
  if (detail?.code && typeof detail.code === "string") return detail.code
  const fromMsg = message.match(CODE_PATTERN)
  return fromMsg?.[1] ?? null
}

export function mapPayrollBatchWorkflowError(err: {
  message?: string | null
  details?: string | null
  hint?: string | null
} | null): PayrollWorkflowErrorPayload {
  const message = String(err?.message || err?.details || "Payroll batch operation failed")
  const detail = tryParseDetail(err?.details) || tryParseDetail(err?.hint)
  const code = extractCode(message, detail) || "PAYROLL_BATCH_WORKFLOW_FAILED"

  const base: PayrollWorkflowErrorPayload = {
    error: message,
    code,
    status: 400,
  }

  switch (code) {
    case "PAYROLL_PAYMENT_PERMISSION_DENIED":
    case "PAYROLL_ACTOR_IDENTITY_MISMATCH":
      base.status = 403
      break
    case "PAYROLL_BATCH_INVALID_STATUS_TRANSITION":
    case "PAYROLL_BATCH_HAS_POSTED_PAYMENTS":
    case "PAYROLL_BATCH_DESTINATION_INCOMPLETE":
    case "PAYROLL_BATCH_TOTAL_MISMATCH":
    case "PAYROLL_BATCH_ITEM_INVALID_STATUS_TRANSITION":
    case "PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED":
    case "PAYROLL_BATCH_PAYMENT_RECONCILIATION_FAILED":
    case "PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT":
    case "PAYROLL_PAYMENT_BATCH_LINK_CONFLICT":
    case "PAYROLL_PAYMENT_BATCH_AMOUNT_MISMATCH":
    case "PAYROLL_PAYMENT_BATCH_IDENTITY_MISMATCH":
      base.status = 409
      break
    case "PAYROLL_PAYMENT_IDEMPOTENCY_KEY_REQUIRED":
      base.status = 400
      break
    default:
      base.status = 400
  }

  return base
}
