/**
 * Extractable helpers for invoice material return UI eligibility.
 * Kept tiny so UI rendering rules can be unit-tested without mounting the page.
 */

export type FulfilmentHistoryRow = {
  id: string
  quantity: number
  quantity_returned?: number | null
  status?: string | null
}

export function fulfilmentReturnableQuantity(f: FulfilmentHistoryRow): number {
  const quantity = Number(f.quantity) || 0
  const returned = Number(f.quantity_returned || 0)
  return Math.max(0, Math.round((quantity - returned) * 10000) / 10000)
}

export function canShowReturnMaterialsAction(opts: {
  materialInventorySource: string | null | undefined
  readOnly: boolean
  invoiceStatus: string
  fulfilment: FulfilmentHistoryRow
}): boolean {
  const status = String(opts.invoiceStatus || "").toLowerCase()
  if (opts.readOnly) return false
  if (["draft", "cancelled", "void"].includes(status)) return false
  if (opts.materialInventorySource !== "direct_sale") return false
  if (String(opts.fulfilment.status || "active") !== "active") return false
  return fulfilmentReturnableQuantity(opts.fulfilment) > 0
}
