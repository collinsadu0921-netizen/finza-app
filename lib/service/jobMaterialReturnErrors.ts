/**
 * Maps return_service_job_material_usage RPC errors to HTTP responses.
 */

export function mapJobMaterialReturnRpcError(message: string): {
  status: number
  code: string
  error: string
} {
  const msg = message ?? "Material return failed"

  const codeMatch = msg.match(
    /\b(USAGE_ALREADY_RETURNED|USAGE_NOT_FOUND|USAGE_COGS_LINK_MISSING|USAGE_RETURN_INVALID_ARGS|USAGE_RETURN_INVALID_STATUS|USAGE_RETURN_INVALID_QTY|USAGE_RETURN_IDEMPOTENCY_CONFLICT|JOB_NOT_FOUND|JOB_MATERIALS_ALREADY_REVERSED|MATERIAL_NOT_FOUND|CROSS_TENANT|PERIOD_LOCKED|ACCOUNT_CONFIGURATION_REQUIRED)\b/
  )
  const code = codeMatch?.[1]

  switch (code) {
    case "USAGE_ALREADY_RETURNED":
      return { status: 409, code, error: "This material usage has already been returned." }
    case "USAGE_NOT_FOUND":
    case "JOB_NOT_FOUND":
    case "MATERIAL_NOT_FOUND":
      return { status: 404, code, error: msg.replace(/^[A-Z_]+:\s*/, "") }
    case "CROSS_TENANT":
      return { status: 403, code, error: "Cross-tenant reference blocked." }
    case "PERIOD_LOCKED":
      return {
        status: 403,
        code,
        error: "Accounting period is locked; consumed material return cannot post a COGS reversal.",
      }
    case "USAGE_COGS_LINK_MISSING":
      return {
        status: 409,
        code,
        error: "Consumed usage is missing its COGS journal link; refusing to reverse.",
      }
    case "JOB_MATERIALS_ALREADY_REVERSED":
      return {
        status: 409,
        code,
        error: "Job materials were already restored on cancellation.",
      }
    case "USAGE_RETURN_IDEMPOTENCY_CONFLICT":
      return { status: 409, code, error: "Idempotency key already used for another usage." }
    case "USAGE_RETURN_INVALID_ARGS":
    case "USAGE_RETURN_INVALID_STATUS":
    case "USAGE_RETURN_INVALID_QTY":
      return { status: 400, code: code ?? "VALIDATION_ERROR", error: msg.replace(/^[A-Z_]+:\s*/, "") }
    case "ACCOUNT_CONFIGURATION_REQUIRED":
      return { status: 422, code, error: msg.replace(/^[A-Z_]+:\s*/, "") }
    default:
      if (/period.*closed|locked|soft_closed/i.test(msg)) {
        return { status: 403, code: "PERIOD_LOCKED", error: msg }
      }
      return { status: 500, code: "MATERIAL_RETURN_FAILED", error: msg }
  }
}

export type JobMaterialReturnResult = {
  usage_id: string
  status: string
  quantity_restored: number
  return_movement_id: string | null
  return_journal_entry_id: string | null
  original_cogs_journal_entry_id: string | null
  unit_cost: number
  total_cost: number
  return_date: string
  idempotent: boolean
}
