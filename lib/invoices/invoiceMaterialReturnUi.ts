/**
 * Extractable helpers for invoice material fulfilment / return / undo-return UI.
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
  returned_gross_quantity?: number | null
  undo_return_quantity?: number | null
  net_returned_quantity?: number | null
  returns?: ReturnHistoryRow[] | null
}

export type ReturnHistoryRow = {
  id: string
  quantity: number
  quantity_undone?: number | null
  undoable_quantity?: number | null
  unit_cost?: number | null
  status?: string | null
  created_at?: string | null
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

/**
 * Net returned across fulfilments.
 * Prefers fulfilment.quantity_returned (authoritative net after undos).
 */
export function lineReturnedQuantity(fulfilments: FulfilmentHistoryRow[]): number {
  return roundQty(
    (fulfilments ?? []).reduce(
      (sum, f) =>
        sum +
        (Number(
          f.net_returned_quantity != null ? f.net_returned_quantity : f.quantity_returned
        ) || 0),
      0
    )
  )
}

export function lineReturnedGrossQuantity(fulfilments: FulfilmentHistoryRow[]): number {
  return roundQty(
    (fulfilments ?? []).reduce((sum, f) => {
      if (f.returned_gross_quantity != null) {
        return sum + (Number(f.returned_gross_quantity) || 0)
      }
      const fromReturns = (f.returns ?? []).reduce(
        (s, r) => s + (Number(r.quantity) || 0),
        0
      )
      return sum + fromReturns
    }, 0)
  )
}

export function lineUndoReturnQuantity(fulfilments: FulfilmentHistoryRow[]): number {
  return roundQty(
    (fulfilments ?? []).reduce((sum, f) => {
      if (f.undo_return_quantity != null) {
        return sum + (Number(f.undo_return_quantity) || 0)
      }
      const fromReturns = (f.returns ?? []).reduce(
        (s, r) => s + (Number(r.quantity_undone) || 0),
        0
      )
      return sum + fromReturns
    }, 0)
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
 * returnable_quantity = fulfilled_quantity - net_returned_quantity
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

/** active_fulfilled = gross fulfilled - net returned */
export function activeFulfilledQuantity(
  fulfilledQuantity: number,
  netReturnedQuantity: number
): number {
  return returnableQuantity(fulfilledQuantity, netReturnedQuantity)
}

export function fulfilmentReturnableQuantity(f: FulfilmentHistoryRow): number {
  const netReturned = Number(
    f.net_returned_quantity != null ? f.net_returned_quantity : f.quantity_returned
  ) || 0
  return returnableQuantity(Number(f.quantity) || 0, netReturned)
}

export function returnUndoableQuantity(r: ReturnHistoryRow): number {
  if (r.undoable_quantity != null) {
    return Math.max(0, roundQty(Number(r.undoable_quantity) || 0))
  }
  return Math.max(
    0,
    roundQty((Number(r.quantity) || 0) - (Number(r.quantity_undone) || 0))
  )
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

/**
 * Undo return visibility depends on remaining undoable quantity on the return.
 */
export function canShowUndoReturnAction(opts: {
  materialInventorySource: string | null | undefined
  readOnly: boolean
  invoiceStatus: string
  returnRow: ReturnHistoryRow
}): boolean {
  const status = String(opts.invoiceStatus || "").toLowerCase()
  if (opts.readOnly) return false
  if (["draft", "cancelled", "void"].includes(status)) return false
  if (opts.materialInventorySource !== "direct_sale") return false
  if (String(opts.returnRow.status || "active") === "fully_undone") return false
  return returnUndoableQuantity(opts.returnRow) > 0
}

/** Normalize API fulfilments payload into an array (defensive). */
export function normalizeFulfilments(
  value: unknown
): FulfilmentHistoryRow[] {
  return Array.isArray(value) ? (value as FulfilmentHistoryRow[]) : []
}

export function normalizeReturns(value: unknown): ReturnHistoryRow[] {
  return Array.isArray(value) ? (value as ReturnHistoryRow[]) : []
}
