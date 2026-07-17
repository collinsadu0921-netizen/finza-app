/**
 * Maps post_asset_disposal RPC errors to HTTP responses.
 */

export function mapDisposalRpcError(message: string): { status: number; code: string; error: string } {
  const msg = message ?? "Asset disposal failed"

  if (/not authorized/i.test(msg)) {
    return { status: 403, code: "FORBIDDEN", error: msg }
  }
  if (/asset not found/i.test(msg)) {
    return { status: 404, code: "ASSET_NOT_FOUND", error: msg }
  }
  if (/ASSET_ALREADY_DISPOSED/i.test(msg)) {
    return { status: 409, code: "ASSET_ALREADY_DISPOSED", error: msg }
  }
  if (/INCOMPLETE_DISPOSAL/i.test(msg)) {
    return { status: 409, code: "INCOMPLETE_DISPOSAL", error: msg }
  }
  if (/DEPRECIATION_REQUIRED_BEFORE_DISPOSAL/i.test(msg)) {
    return { status: 409, code: "DEPRECIATION_REQUIRED_BEFORE_DISPOSAL", error: msg }
  }
  if (/NEGATIVE_PROCEEDS/i.test(msg)) {
    return { status: 400, code: "NEGATIVE_PROCEEDS", error: msg }
  }
  if (/INVALID_PAYMENT_ACCOUNT/i.test(msg)) {
    return { status: 400, code: "INVALID_PAYMENT_ACCOUNT", error: msg }
  }
  if (/period.*closed|locked|soft_closed/i.test(msg)) {
    return { status: 403, code: "PERIOD_CLOSED", error: msg }
  }
  if (/ACCOUNT_CONFIGURATION_REQUIRED/i.test(msg)) {
    return { status: 422, code: "ACCOUNT_CONFIGURATION_REQUIRED", error: msg }
  }
  if (/before acquisition/i.test(msg)) {
    return { status: 400, code: "INVALID_DATE", error: msg }
  }

  return { status: 500, code: "DISPOSAL_FAILED", error: msg }
}

export type DisposalPostResult = {
  asset_id: string
  journal_entry_id: string
  disposal_date: string
  proceeds: number
  disposal_type: string
  carrying_value: number
  accumulated_depreciation: number
  gain_loss: number
  idempotent?: boolean
}

export function parseDepreciationRequiredError(message: string): {
  missingPeriodCount?: number
  requiredThroughDate?: string
  lastPostedDate?: string
} {
  const countMatch = message.match(/DEPRECIATION_REQUIRED_BEFORE_DISPOSAL:\s*(\d+)/)
  const throughMatch = message.match(/through\s+(\d{4}-\d{2}-\d{2})/)
  const lastMatch = message.match(/Last posted:\s*([^.\s]+)/)
  return {
    missingPeriodCount: countMatch ? Number(countMatch[1]) : undefined,
    requiredThroughDate: throughMatch?.[1],
    lastPostedDate: lastMatch?.[1] === "none" ? undefined : lastMatch?.[1],
  }
}
