/**
 * Map PostgREST / Postgres errors from reverse_payroll_run_atomic to API payloads.
 */

export type PayrollReversalErrorPayload = {
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

const CODE_RE =
  /\b(PAYROLL_REVERSAL_PERMISSION_DENIED|PAYROLL_REVERSAL_INVALID_STATUS|PAYROLL_REVERSAL_INCONSISTENT_STATE|PAYROLL_REVERSAL_PAYMENTS_EXIST|PAYROLL_REVERSAL_PERIOD_CLOSED|PAYROLL_REVERSAL_ALREADY_COMPLETED|PAYROLL_REVERSAL_ADVANCE_CONFLICT|PAYROLL_CORRECTION_ALREADY_EXISTS|PAYROLL_CORRECTION_INVALID_SOURCE|PAYROLL_REVERSAL_CONFLICT|PAYROLL_RUN_REVERSED)\b/

function extractCode(message: string, detail: Record<string, unknown> | null): string | null {
  if (detail?.code && typeof detail.code === "string") return detail.code
  return message.match(CODE_RE)?.[1] ?? null
}

export function mapReversePayrollRunAtomicError(err: {
  message?: string | null
  details?: string | null
  hint?: string | null
  code?: string | null
} | null): PayrollReversalErrorPayload {
  const message = String(err?.message || err?.details || "Payroll reversal failed")
  const detail = tryParseDetail(err?.details) || tryParseDetail(err?.hint)
  let code =
    extractCode(message, detail) ||
    extractCode(String(err?.details || ""), detail) ||
    null

  if (!code && /period.*(closed|locked|soft_closed)/i.test(message)) {
    code = "PAYROLL_REVERSAL_PERIOD_CLOSED"
  }
  if (!code && /permission/i.test(message)) {
    code = "PAYROLL_REVERSAL_PERMISSION_DENIED"
  }
  if (!code) code = "PAYROLL_REVERSAL_CONFLICT"

  const base: PayrollReversalErrorPayload = {
    error: message.replace(new RegExp(`^${code}:\\s*`), ""),
    code,
    status: 400,
  }

  if (detail) {
    for (const [k, v] of Object.entries(detail)) {
      if (k !== "code" && v !== undefined) base[k] = v
    }
  }

  switch (code) {
    case "PAYROLL_REVERSAL_PERMISSION_DENIED":
      base.status = 403
      break
    case "PAYROLL_REVERSAL_INVALID_STATUS":
    case "PAYROLL_REVERSAL_INCONSISTENT_STATE":
    case "PAYROLL_REVERSAL_PAYMENTS_EXIST":
    case "PAYROLL_REVERSAL_PERIOD_CLOSED":
    case "PAYROLL_REVERSAL_ALREADY_COMPLETED":
    case "PAYROLL_REVERSAL_ADVANCE_CONFLICT":
    case "PAYROLL_CORRECTION_ALREADY_EXISTS":
    case "PAYROLL_RUN_REVERSED":
      base.status = 409
      break
    default:
      base.status = 400
  }

  return base
}
