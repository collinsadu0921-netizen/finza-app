/** Retail buy-list / supplier order statuses (migration 423). */

export const PURCHASE_ORDER_STATUSES = [
  "planned",
  "ordered",
  "partially_received",
  "received",
  "paid",
  "cancelled",
] as const

export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number]

export function purchaseOrderStatusLabel(s: string): string {
  const map: Record<string, string> = {
    planned: "Planned",
    ordered: "Ordered",
    partially_received: "Partially received",
    received: "Received",
    paid: "Paid",
    cancelled: "Cancelled",
    draft: "Planned",
    sent: "Ordered",
  }
  return map[s] || s.replace(/_/g, " ")
}

export function purchaseOrderStatusBadgeTone(
  s: string
): "neutral" | "warning" | "success" | "danger" | "info" {
  if (s === "planned") return "neutral"
  if (s === "ordered") return "info"
  if (s === "partially_received") return "warning"
  if (s === "received" || s === "paid") return "success"
  if (s === "cancelled") return "danger"
  if (s === "draft") return "neutral"
  if (s === "sent") return "info"
  return "neutral"
}
