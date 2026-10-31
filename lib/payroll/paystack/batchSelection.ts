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
  staff_id?: string | null
  staff_payment_method_id?: string | null
  legacy_destination_source?: string | null
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

export type BatchItemPaystackEligibility = {
  eligible: boolean
  reason: string | null
  requiresUpdate: boolean
}

const ACTIVE_TRANSFER_STATUSES = new Set([
  "initiating",
  "awaiting_authorization",
  "pending",
  "successful",
  "requires_attention",
])

export function getBatchItemPaystackEligibility(input: {
  item: BatchItemForPaystackSelection
  transfer?: BatchTransferForPaystackSelection | null
  paystackEnabled: boolean
  batchStatus: string
}): BatchItemPaystackEligibility {
  const { item, transfer, paystackEnabled, batchStatus } = input

  if (!paystackEnabled) {
    return {
      eligible: false,
      reason: "Paystack is not connected for this workspace.",
      requiresUpdate: false,
    }
  }

  if (String(batchStatus || "").toLowerCase() === "cancelled") {
    return { eligible: false, reason: "This payment batch was cancelled.", requiresUpdate: false }
  }

  if (item.payroll_payment_id) {
    return { eligible: false, reason: "Payment already completed.", requiresUpdate: false }
  }

  const itemStatus = String(item.status || "").toLowerCase()
  if (itemStatus === "paid") {
    return { eligible: false, reason: "Payment already completed.", requiresUpdate: false }
  }

  if (transfer) {
    const transferStatus = String(transfer.status || "").toLowerCase()
    if (ACTIVE_TRANSFER_STATUSES.has(transferStatus)) {
      return {
        eligible: false,
        reason:
          transferStatus === "successful"
            ? "Payment already completed."
            : "Payment already completed or processing.",
        requiresUpdate: false,
      }
    }
    if (transferStatus !== "failed" && transferStatus !== "reversed") {
      return {
        eligible: false,
        reason: "Payment already completed or processing.",
        requiresUpdate: false,
      }
    }
  }

  if (itemStatus !== "pending" && itemStatus !== "failed") {
    return {
      eligible: false,
      reason: "Payment is not currently available.",
      requiresUpdate: false,
    }
  }

  const amount = Number(item.amount || 0)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { eligible: false, reason: "Salary amount is invalid.", requiresUpdate: false }
  }

  const method = String(item.destination_method_type || "").toLowerCase()
  const methodMissing =
    !method || String(item.legacy_destination_source || "").toLowerCase() === "missing"
  if (methodMissing) {
    return { eligible: false, reason: "Missing default payment method.", requiresUpdate: true }
  }

  const accountName = String(item.destination_account_name || "").trim()

  if (method === "momo") {
    if (!String(item.destination_momo_provider || "").trim()) {
      return { eligible: false, reason: "Missing Mobile Money provider.", requiresUpdate: true }
    }
    if (!String(item.destination_momo_number || "").trim()) {
      return { eligible: false, reason: "Missing Mobile Money number.", requiresUpdate: true }
    }
    if (!accountName) {
      return { eligible: false, reason: "Missing account holder name.", requiresUpdate: true }
    }
    return { eligible: true, reason: null, requiresUpdate: false }
  }

  if (method === "bank") {
    if (
      !String(item.destination_bank_code || "").trim() ||
      !String(item.destination_bank_name || "").trim()
    ) {
      return { eligible: false, reason: "Missing bank provider or bank code.", requiresUpdate: true }
    }
    if (!String(item.destination_account_number || "").trim()) {
      return { eligible: false, reason: "Missing bank account number.", requiresUpdate: true }
    }
    if (!accountName) {
      return { eligible: false, reason: "Missing account holder name.", requiresUpdate: true }
    }
    return { eligible: true, reason: null, requiresUpdate: false }
  }

  return { eligible: false, reason: "Unsupported payment method.", requiresUpdate: true }
}

export function isBatchItemPaystackEligible(input: {
  item: BatchItemForPaystackSelection
  transfer?: BatchTransferForPaystackSelection | null
  paystackEnabled: boolean
  batchStatus: string
}): boolean {
  return getBatchItemPaystackEligibility(input).eligible
}

export function sumBatchItemAmounts(items: BatchItemForPaystackSelection[]): number {
  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  return Math.round(total * 100) / 100
}
