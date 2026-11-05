import { createPayrollPaymentIdempotencyKey } from "../createPayrollPaymentIdempotencyKey"

export type BatchPaystackPaymentItem = {
  id: string
  employee_name: string | null
  amount: number | string | null
}

export type BatchPaystackPaymentStatus =
  | "successful"
  | "processing"
  | "failed"
  | "requires_authorization"
  | "uncertain"

export type BatchPaystackPaymentResult = {
  itemId: string
  status: BatchPaystackPaymentStatus
  transferId?: string | null
  error?: string
}

export type BatchPaystackRunResult = {
  paid: number
  processing: number
  failed: number
  stoppedForAuthorization: boolean
  networkUncertain: boolean
  results: BatchPaystackPaymentResult[]
}

type FetchLike = typeof fetch

/**
 * Pays selected batch employees through the existing per-employee Paystack
 * endpoint. Each request keeps its own idempotency key, reference and
 * settlement path. One failure never marks the whole batch paid or failed.
 */
export async function runBatchPaystackPayments(input: {
  runId: string
  batchId: string
  items: BatchPaystackPaymentItem[]
  fetchImpl?: FetchLike
  createIdempotencyKey?: () => string
  onAuthorizationRequired?: (
    item: BatchPaystackPaymentItem,
    result: BatchPaystackPaymentResult
  ) => void
  onItemComplete?: (
    item: BatchPaystackPaymentItem,
    result: BatchPaystackPaymentResult,
    index: number,
    total: number
  ) => void | Promise<void>
}): Promise<BatchPaystackRunResult> {
  const {
    runId,
    batchId,
    items,
    fetchImpl = fetch,
    createIdempotencyKey = () => createPayrollPaymentIdempotencyKey("payroll-batch-item"),
    onAuthorizationRequired,
    onItemComplete,
  } = input

  const results: BatchPaystackPaymentResult[] = []
  let stoppedForAuthorization = false
  let networkUncertain = false

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const idempotencyKey = createIdempotencyKey()
    let result: BatchPaystackPaymentResult

    try {
      const response = await fetchImpl(
        `/api/payroll/runs/${runId}/payment-batches/${batchId}/items/${item.id}/paystack-pay`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ confirm: true, idempotency_key: idempotencyKey }),
        }
      )
      const body = await response.json().catch(() => ({}))
      const status = String(body.status || "")
      const needsAuthorization =
        Boolean(body.otp_required) ||
        status === "awaiting_authorization" ||
        status === "requires_attention"

      if (!response.ok && response.status !== 202) {
        if (needsAuthorization) {
          result = {
            itemId: item.id,
            status: "requires_authorization",
            transferId: body.transfer_id ?? null,
            error: String(body.error || body.message || ""),
          }
        } else if (body.code === "TRANSFER_PENDING" || body.code === "ALREADY_PAID") {
          result = {
            itemId: item.id,
            status: "processing",
            transferId: body.transfer_id ?? null,
            error: String(body.error || ""),
          }
        } else {
          result = {
            itemId: item.id,
            status: "failed",
            error: String(body.error || "Paystack could not initiate this transfer."),
          }
        }
      } else if (status === "successful") {
        result = {
          itemId: item.id,
          status: "successful",
          transferId: body.transfer_id ?? null,
        }
      } else if (needsAuthorization) {
        result = {
          itemId: item.id,
          status: "requires_authorization",
          transferId: body.transfer_id ?? null,
          error: String(body.message || ""),
        }
      } else {
        result = {
          itemId: item.id,
          status: "processing",
          transferId: body.transfer_id ?? null,
          error: String(body.message || ""),
        }
      }
    } catch {
      result = { itemId: item.id, status: "uncertain" }
      networkUncertain = true
    }

    results.push(result)
    await onItemComplete?.(item, result, index, items.length)

    if (result.status === "requires_authorization") {
      stoppedForAuthorization = true
      onAuthorizationRequired?.(item, result)
      break
    }
    if (result.status === "uncertain") break
  }

  return {
    paid: results.filter((result) => result.status === "successful").length,
    processing: results.filter((result) => result.status === "processing").length,
    failed: results.filter((result) => result.status === "failed").length,
    stoppedForAuthorization,
    networkUncertain,
    results,
  }
}
