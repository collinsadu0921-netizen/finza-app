/**
 * Maps backfill and batch RPC errors to HTTP responses.
 */

export function mapBackfillRpcError(message: string): { status: number; code: string; error: string } {
  const msg = message ?? "Historical depreciation backfill failed"
  if (/not authorized/i.test(msg)) return { status: 403, code: "FORBIDDEN", error: msg }
  if (/asset not found/i.test(msg)) return { status: 404, code: "ASSET_NOT_FOUND", error: msg }
  if (/Cannot backfill|Cannot depreciate/i.test(msg)) return { status: 400, code: "ASSET_NOT_ACTIVE", error: msg }
  if (/period.*closed|locked|soft_closed/i.test(msg)) return { status: 403, code: "PERIOD_CLOSED", error: msg }
  if (/ACCOUNT_CONFIGURATION_REQUIRED/i.test(msg)) return { status: 422, code: "ACCOUNT_CONFIGURATION_REQUIRED", error: msg }
  return { status: 500, code: "BACKFILL_FAILED", error: msg }
}

export function mapBatchRpcError(message: string): { status: number; code: string; error: string } {
  const msg = message ?? "Bulk depreciation failed"
  if (/not authorized/i.test(msg)) return { status: 403, code: "FORBIDDEN", error: msg }
  if (/Posting date is required/i.test(msg)) return { status: 400, code: "VALIDATION_ERROR", error: msg }
  return { status: 500, code: "BATCH_FAILED", error: msg }
}

export type BatchDepreciationResult = {
  business_id: string
  posting_date: string
  posted: BatchItem[]
  skipped: BatchItem[]
  failed: BatchItem[]
  posted_count: number
  skipped_count: number
  failed_count: number
  partial_success: boolean
  success: boolean
}

export type BatchItem = {
  asset_id: string
  asset_name?: string
  period?: string
  amount?: string | number
  depreciation_entry_id?: string
  journal_entry_id?: string
  code?: string
  message?: string
}
