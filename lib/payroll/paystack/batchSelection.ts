/**
 * Client-safe selection rules for paying multiple batch employees with Paystack.
 *
 * Only employees that the existing per-employee endpoint can safely pay are
 * selectable. Ineligible rows stay visible and can still be paid individually
 * or recorded manually.
 */

export type BatchItemForPaystackSelection = {
  status: string
  amount: number | string | null
  payroll_payment_id?: string | null
  destination_method_type?: string | null
  destination_bank_code?: string | null
  destination_bank_name?: string | null
  destination_account_number?: string | null
  destination_account_name?: string | null
  destination_momo_provider?: string | null
  destination_momo_number?: string | null
}

export type BatchTransferForPaystackSelection = {
  status: string
}

const ACTIVE_TRANSFER_STATUSES = new Set([
  "initiating",
  "awaiting_authorization",
  "pending",
  "successful",
  "requires_attention",
])

export function isBatchItemPaystackEligible(input: {
  item: BatchItemForPaystackSelection
  transfer?: BatchTransferForPaystackSelection | null
  paystackEnabled: boolean
  batchStatus: string
}): boolean {
  const { item, transfer, paystackEnabled, batchStatus } = input
  if (!paystackEnabled) return false
  if (String(batchStatus || "").toLowerCase() === "cancelled") return false
  if (item.payroll_payment_id) return false

  const itemStatus = String(item.status || "").toLowerCase()
  if (itemStatus !== "pending" && itemStatus !== "failed") return false

  const amount = Number(item.amount || 0)
  if (!Number.isFinite(amount) || amount <= 0) return false

  if (transfer) {
    const transferStatus = String(transfer.status || "").toLowerCase()
    if (ACTIVE_TRANSFER_STATUSES.has(transferStatus)) return false
    if (transferStatus !== "failed" && transferStatus !== "reversed") return false
  }

  const method = String(item.destination_method_type || "").toLowerCase()
  const accountName = String(item.destination_account_name || "").trim()

  if (method === "momo") {
    return Boolean(
      String(item.destination_momo_provider || "").trim() &&
        String(item.destination_momo_number || "").trim() &&
        accountName
    )
  }

  if (method === "bank") {
    return Boolean(
      String(item.destination_bank_code || "").trim() &&
        String(item.destination_bank_name || "").trim() &&
        String(item.destination_account_number || "").trim() &&
        accountName
    )
  }

  return false
}

export function sumBatchItemAmounts(items: BatchItemForPaystackSelection[]): number {
  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  return Math.round(total * 100) / 100
}
