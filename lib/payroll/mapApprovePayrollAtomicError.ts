/**
 * Map PostgREST / Postgres errors from approve_payroll_run_atomic to API payloads.
 */

export type PayrollApprovalErrorPayload = {
  error: string
  code: string
  status: number
  differences?: unknown
  affectedEmployees?: unknown
  affectedAdvances?: unknown
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

function extractCode(message: string, detail: Record<string, unknown> | null): string | null {
  if (detail?.code && typeof detail.code === "string") return detail.code
  const fromMsg = message.match(
    /\b(PAYROLL_TOTALS_OUT_OF_SYNC|PAYROLL_APPROVAL_INCONSISTENT_STATE|PAYROLL_APPROVAL_CONFLICT|PAYROLL_APPROVAL_PERIOD_CLOSED|PAYROLL_APPROVAL_OBLIGATION_FAILED|PAYROLL_APPROVAL_PERMISSION_DENIED|PAYROLL_RUN_REVERSED|GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE|GHANA_PAYROLL_UNKNOWN_RATE_VERSION|GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED|SALARY_ADVANCE_RECOVERY_EXCEEDS_OUTSTANDING|NON_MONTHLY_STATUTORY_APPROVAL_BLOCKED)\b/
  )
  return fromMsg?.[1] ?? null
}

export function mapApprovePayrollRunAtomicError(err: {
  message?: string | null
  details?: string | null
  hint?: string | null
  code?: string | null
} | null): PayrollApprovalErrorPayload {
  const message = String(err?.message || err?.details || "Payroll approval failed")
  const detail = tryParseDetail(err?.details) || tryParseDetail(err?.hint)
  let code =
    extractCode(message, detail) ||
    extractCode(String(err?.details || ""), detail) ||
    null

  if (!code && /period.*(closed|locked|soft_closed)/i.test(message)) {
    code = "PAYROLL_APPROVAL_PERIOD_CLOSED"
  }
  if (!code) code = "PAYROLL_APPROVAL_CONFLICT"

  const base: PayrollApprovalErrorPayload = {
    error: message,
    code,
    status: 400,
  }

  if (detail?.differences) base.differences = detail.differences
  if (detail?.affectedEmployees) base.affectedEmployees = detail.affectedEmployees
  if (detail?.affectedAdvances) base.affectedAdvances = detail.affectedAdvances

  switch (code) {
    case "PAYROLL_TOTALS_OUT_OF_SYNC":
      base.error = message.includes("reconcile")
        ? message
        : "Payroll run totals do not reconcile to included entries"
      if (detail?.differences) {
        base.differences = detail.differences
      }
      base.status = 409
      break
    case "PAYROLL_APPROVAL_INCONSISTENT_STATE":
      base.status = 409
      break
    case "PAYROLL_APPROVAL_PERIOD_CLOSED":
      base.status = 409
      break
    case "PAYROLL_APPROVAL_OBLIGATION_FAILED":
      base.status = 409
      break
    case "PAYROLL_APPROVAL_CONFLICT":
      base.status = 409
      break
    case "PAYROLL_APPROVAL_PERMISSION_DENIED":
      base.status = 403
      break
    case "PAYROLL_RUN_REVERSED":
      base.error = "Payroll run has been reversed and cannot be approved"
      base.status = 409
      break
    case "SALARY_ADVANCE_RECOVERY_EXCEEDS_OUTSTANDING":
      base.error =
        "One or more advance recoveries now exceed the outstanding balance. Recalculate the draft payroll before approving."
      base.status = 409
      if (detail) {
        base.affectedAdvances = [
          {
            advanceId: detail.advanceId,
            staffId: detail.staffId,
            snapshottedAmount: detail.snapshottedAmount,
            currentOutstandingAmount: detail.currentOutstandingAmount,
          },
        ]
      }
      break
    case "GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE":
    case "GHANA_PAYROLL_UNKNOWN_RATE_VERSION":
    case "GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED":
      base.status = 400
      break
    default:
      if (/period.*(closed|locked|soft_closed)/i.test(message)) {
        base.code = "PAYROLL_APPROVAL_PERIOD_CLOSED"
        base.status = 409
      } else {
        base.status = 500
      }
  }

  return base
}
