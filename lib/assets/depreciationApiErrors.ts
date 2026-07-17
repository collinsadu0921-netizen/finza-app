/**
 * Maps post_asset_depreciation / reverse_asset_depreciation RPC errors to HTTP responses.
 */

export function mapDepreciationRpcError(message: string): { status: number; code: string; error: string } {
  const msg = message ?? "Depreciation posting failed"

  if (/not authorized/i.test(msg)) {
    return { status: 403, code: "FORBIDDEN", error: msg }
  }
  if (/asset not found/i.test(msg)) {
    return { status: 404, code: "ASSET_NOT_FOUND", error: msg }
  }
  if (/depreciation entry not found/i.test(msg)) {
    return { status: 404, code: "ENTRY_NOT_FOUND", error: msg }
  }
  if (/already posted|already reversed|duplicate/i.test(msg)) {
    return { status: 409, code: "DUPLICATE_POSTING", error: msg }
  }
  if (/fully depreciated|must be greater than zero|exceeds remaining/i.test(msg)) {
    return { status: 400, code: "INVALID_AMOUNT", error: msg }
  }
  if (/disposed|status/i.test(msg) && /cannot depreciate/i.test(msg)) {
    return { status: 400, code: "ASSET_NOT_ACTIVE", error: msg }
  }
  if (/period.*closed|locked|soft_closed/i.test(msg)) {
    return { status: 403, code: "PERIOD_CLOSED", error: msg }
  }
  if (/adjustment reason|reversal reason|reason is required/i.test(msg)) {
    return { status: 400, code: "REASON_REQUIRED", error: msg }
  }
  if (/incomplete depreciation|reconciliation required/i.test(msg)) {
    return { status: 409, code: "INCOMPLETE_ENTRY", error: msg }
  }
  if (/ACCOUNT_CONFIGURATION_REQUIRED/i.test(msg)) {
    return { status: 422, code: "ACCOUNT_CONFIGURATION_REQUIRED", error: msg }
  }
  if (/invalid.*account/i.test(msg)) {
    return { status: 422, code: "ACCOUNT_CONFIGURATION_REQUIRED", error: msg }
  }
  if (/before asset purchase/i.test(msg)) {
    return { status: 400, code: "INVALID_DATE", error: msg }
  }
  if (/ACCOUNTING_RECORD_IMMUTABLE/i.test(msg)) {
    return { status: 403, code: "DELETE_NOT_ALLOWED", error: msg }
  }

  return { status: 500, code: "DEPRECIATION_POST_FAILED", error: msg }
}
