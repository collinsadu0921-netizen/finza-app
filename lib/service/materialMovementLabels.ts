/** Maps internal movement types + reason codes to tenant-facing labels. */

export const STOCK_IN_REASONS = [
  { value: "bought_material", label: "Bought material" },
  { value: "existing_stock", label: "Existing stock" },
  { value: "returned_from_job", label: "Returned from job" },
  { value: "correction", label: "Correction" },
] as const

export const STOCK_OUT_REASONS = [
  { value: "used_for_job", label: "Used for job" },
  { value: "damaged_lost", label: "Damaged/lost" },
  { value: "correction", label: "Correction" },
  { value: "returned_to_supplier", label: "Returned to supplier" },
] as const

export type StockInReason = (typeof STOCK_IN_REASONS)[number]["value"]
export type StockOutReason = (typeof STOCK_OUT_REASONS)[number]["value"]

const REASON_LABELS: Record<string, string> = {
  bought_material: "Bought material",
  existing_stock: "Existing stock",
  returned_from_job: "Returned from job",
  correction: "Correction",
  used_for_job: "Used for job",
  damaged_lost: "Damaged/lost",
  returned_to_supplier: "Returned to supplier",
}

export function movementActionLabel(movementType: string, reasonCode?: string | null): string {
  const qtyType = movementType.trim().toLowerCase()
  if (qtyType === "setup_stock" || qtyType === "stock_in" || qtyType === "purchase" || qtyType === "bill_receipt") {
    return "Added"
  }
  if (qtyType === "return" || qtyType === "supplier_return") {
    return "Returned"
  }
  if (qtyType === "stock_out" || qtyType === "write_off" || qtyType === "job_usage") {
    return "Used"
  }
  if (qtyType === "adjustment") {
    return "Corrected"
  }
  return "Updated"
}

export function movementReasonLabel(reasonCode?: string | null): string {
  if (!reasonCode) return "—"
  return REASON_LABELS[reasonCode] ?? reasonCode.replace(/_/g, " ")
}

export function stockStatusLabel(row: {
  quantity_on_hand: number
  reorder_level: number
  is_active: boolean
}): { label: string; tone: "ok" | "low" | "out" | "inactive" } {
  if (!row.is_active) return { label: "Inactive", tone: "inactive" }
  const qty = Number(row.quantity_on_hand ?? 0)
  const reorder = Number(row.reorder_level ?? 0)
  if (qty <= 0) return { label: "No stock", tone: "out" }
  if (reorder > 0 && qty <= reorder) return { label: "Low stock", tone: "low" }
  return { label: "In stock", tone: "ok" }
}

export function isValidStockInReason(value: string): value is StockInReason {
  return STOCK_IN_REASONS.some((r) => r.value === value)
}

export function isValidStockOutReason(value: string): value is StockOutReason {
  return STOCK_OUT_REASONS.some((r) => r.value === value)
}

export function stockOutMovementType(reason: StockOutReason): "stock_out" | "write_off" | "supplier_return" {
  if (reason === "returned_to_supplier") return "supplier_return"
  if (reason === "damaged_lost") return "write_off"
  return "stock_out"
}
