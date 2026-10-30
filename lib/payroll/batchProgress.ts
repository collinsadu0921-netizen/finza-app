/**
 * Shared payroll payment-batch progress helpers.
 *
 * Display status is derived from the authoritative batch item status and the
 * linked Paystack transfer status. A transfer that is still pending must never
 * be shown as paid just because the API call succeeded.
 */

export type BatchItemLike = {
  id?: string
  status: string
  amount: number | string | null
}

export type BatchTransferLike = {
  batch_item_id?: string | null
  status: string
}

export type BatchItemDisplayStatus =
  | "paid"
  | "processing"
  | "pending"
  | "failed"
  | "skipped"
  | "cancelled"

export type BatchProgress = {
  applicableCount: number
  paidCount: number
  pendingCount: number
  processingCount: number
  failedCount: number
  skippedCount: number
  totalAmount: number
  paidAmount: number
  outstandingAmount: number
}

const PROCESSING_TRANSFER_STATUSES = new Set([
  "initiating",
  "pending",
  "awaiting_authorization",
  "requires_attention",
  "successful",
])

export function getBatchItemDisplayStatus(
  itemStatus: string,
  transferStatus?: string | null
): BatchItemDisplayStatus {
  const item = String(itemStatus || "").toLowerCase()
  if (item === "paid") return "paid"
  if (item === "skipped") return "skipped"
  if (item === "cancelled") return "cancelled"

  const transfer = String(transferStatus || "").toLowerCase()
  if (transfer === "failed" || transfer === "reversed") return "failed"
  if (PROCESSING_TRANSFER_STATUSES.has(transfer)) return "processing"

  if (item === "failed") return "failed"
  return "pending"
}

export function computeBatchProgress(
  items: BatchItemLike[],
  transfers: BatchTransferLike[] = []
): BatchProgress {
  const transferByItem = new Map<string, string>()
  for (const transfer of transfers) {
    const itemId = transfer.batch_item_id
    if (itemId && !transferByItem.has(itemId)) {
      transferByItem.set(itemId, transfer.status)
    }
  }

  let applicableCount = 0
  let paidCount = 0
  let pendingCount = 0
  let processingCount = 0
  let failedCount = 0
  let skippedCount = 0
  let totalAmount = 0
  let paidAmount = 0

  for (const item of items) {
    const amount = Number(item.amount || 0)
    const display = getBatchItemDisplayStatus(
      item.status,
      item.id ? transferByItem.get(item.id) : undefined
    )

    if (display === "skipped" || display === "cancelled") {
      skippedCount += 1
      continue
    }

    applicableCount += 1
    totalAmount += amount

    if (display === "paid") {
      paidCount += 1
      paidAmount += amount
    } else if (display === "processing") {
      processingCount += 1
    } else if (display === "failed") {
      failedCount += 1
    } else {
      pendingCount += 1
    }
  }

  return {
    applicableCount,
    paidCount,
    pendingCount,
    processingCount,
    failedCount,
    skippedCount,
    totalAmount: roundMoney(totalAmount),
    paidAmount: roundMoney(paidAmount),
    outstandingAmount: roundMoney(Math.max(0, totalAmount - paidAmount)),
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export const BATCH_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  ready: "Ready to pay",
  processing: "Paying",
  partially_paid: "Part paid",
  paid: "Paid",
  failed: "Needs attention",
  cancelled: "Cancelled",
}

export function batchStatusLabel(status: string): string {
  return BATCH_STATUS_LABELS[String(status || "").toLowerCase()] || String(status || "").replace(/_/g, " ")
}

export const BATCH_ITEM_STATUS_LABELS: Record<BatchItemDisplayStatus, string> = {
  paid: "Paid",
  processing: "Processing",
  pending: "Pending",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
}
