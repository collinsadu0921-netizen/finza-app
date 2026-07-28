/**
 * Extractable helpers for invoice material fulfilment / return UI quantities.
 * Kept tiny so UI rendering rules can be unit-tested without mounting the page.
 */

export type FulfilmentHistoryRow = {
  id: string
  quantity: number
  quantity_returned?: number | null
  status?: string | null
  unit_cost?: number | null
  total_cost?: number | null
  created_at?: string | null
  journal_entry_id?: string | null
}

function roundQty(n: number): number {
  return Math.round(n * 10000) / 10000
}

/** Gross fulfilled quantity (sum of fulfilment.quantity). */
export function lineFulfilledQuantity(fulfilments: FulfilmentHistoryRow[]): number {
  return roundQty(
    (fulfilments ?? []).reduce((sum, f) => sum + (Number(f.quantity) || 0), 0)
  )
}

/** Total returned across fulfilments. */
export function lineReturnedQuantity(fulfilments: FulfilmentHistoryRow[]): number {
  return roundQty(
    (fulfilments ?? []).reduce(
      (sum, f) => sum + (Number(f.quantity_returned) || 0),
      0
    )
  )
}

/**
 * remaining_to_fulfil = ordered_quantity - fulfilled_quantity (gross)
 * Independent of returns.
 */
export function remainingToFulfilQuantity(
  orderedQuantity: number,
  fulfilledQuantity: number
): number {
  return Math.max(
    0,
    roundQty((Number(orderedQuantity) || 0) - (Number(fulfilledQuantity) || 0))
  )
}

/**
 * returnable_quantity = fulfilled_quantity - returned_quantity
 * Independent of remaining_to_fulfil.
 */
export function returnableQuantity(
  fulfilledQuantity: number,
  returnedQuantity: number
): number {
  return Math.max(
    0,
    roundQty((Number(fulfilledQuantity) || 0) - (Number(returnedQuantity) || 0))
  )
}

export function fulfilmentReturnableQuantity(f: FulfilmentHistoryRow): number {
  return returnableQuantity(Number(f.quantity) || 0, Number(f.quantity_returned) || 0)
}

/**
 * Return materials visibility depends on returnable_quantity > 0.
 * It must NOT depend on remaining_to_fulfil > 0.
 */
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

/** Normalize API fulfilments payload into an array (defensive). */
export function normalizeFulfilments(
  value: unknown
): FulfilmentHistoryRow[] {
  return Array.isArray(value) ? (value as FulfilmentHistoryRow[]) : []
}
