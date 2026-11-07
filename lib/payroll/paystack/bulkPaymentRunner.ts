import { createPayrollPaymentIdempotencyKey } from "../createPayrollPaymentIdempotencyKey"

export type BulkPaystackPaymentResult = {
  item_id: string
  transfer_id?: string | null
  reference?: string | null
  status: string
  message?: string
}

export type BulkPaystackRunOutcome = {
  paid: number
  processing: number
  requiresAttention: number
  failed: number
  results: BulkPaystackPaymentResult[]
  bulkUnavailable: boolean
  networkUncertain: boolean
  error?: string
  code?: string
}

type FetchLike = typeof fetch

/**
 * Submits selected employees through Paystack's genuine /transfer/bulk endpoint.
 * Individual per-employee transfer stays available if the account cannot use
 * bulk transfers (for example because Transfers OTP is still enabled).
 */
export async function runBulkPaystackPayments(input: {
  runId: string
  batchId: string
  itemIds: string[]
  fetchImpl?: FetchLike
  createIdempotencyKey?: () => string
}): Promise<BulkPaystackRunOutcome> {
  const {
    runId,
    batchId,
    itemIds,
    fetchImpl = fetch,
    createIdempotencyKey = () => createPayrollPaymentIdempotencyKey("payroll-bulk"),
  } = input

  if (itemIds.length === 0) {
    return {
      paid: 0,
      processing: 0,
      requiresAttention: 0,
      failed: 0,
      results: [],
      bulkUnavailable: false,
      networkUncertain: false,
      error: "Select at least one employee.",
      code: "NO_ITEMS_SELECTED",
    }
  }

  const idempotencyKey = createIdempotencyKey()
  try {
    const response = await fetchImpl(
      `/api/payroll/runs/${runId}/payment-batches/${batchId}/paystack-bulk`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          confirm: true,
          item_ids: itemIds,
          idempotency_key: idempotencyKey,
        }),
      }
    )
    const body = await response.json().catch(() => ({}))
    const results = Array.isArray(body.results) ? (body.results as BulkPaystackPaymentResult[]) : []
    const bulkUnavailable = body.bulk_unavailable === true

    if (!response.ok && response.status !== 202) {
      return {
        paid: 0,
        processing: 0,
        requiresAttention: 0,
        failed: results.length,
        results,
        bulkUnavailable,
        networkUncertain: false,
        error: String(body.error || "Paystack could not submit the bulk transfer."),
        code: body.code ? String(body.code) : undefined,
      }
    }

    return {
      paid: Number(body.paid ?? results.filter((r) => r.status === "successful").length),
      processing: Number(
        body.processing ?? results.filter((r) => ["pending", "awaiting_authorization"].includes(r.status)).length
      ),
      requiresAttention:
        body.requires_attention ??
        results.filter((r) => r.status === "requires_attention").length,
      failed: Number(body.failed ?? results.filter((r) => r.status === "failed").length),
      results,
      bulkUnavailable,
      networkUncertain: response.status === 202 || body.code === "PAYSTACK_BULK_UNCERTAIN",
      error: body.error ? String(body.error) : undefined,
      code: body.code ? String(body.code) : undefined,
    }
  } catch {
    return {
      paid: 0,
      processing: 0,
      requiresAttention: 0,
      failed: 0,
      results: [],
      bulkUnavailable: false,
      networkUncertain: true,
      error: "The bulk transfer outcome is uncertain. Verify each employee transfer before retrying.",
      code: "PAYSTACK_BULK_UNCERTAIN",
    }
  }
}
