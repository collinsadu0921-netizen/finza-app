/**
 * Tenant-facing material form parsing and DB field mapping.
 * average_cost = calculated stock cost; default_cost_price = tenant buy price.
 */

export type MaterialFormInput = {
  name?: unknown
  unit?: unknown
  description?: unknown
  cost_price?: unknown
  default_cost_price?: unknown
  selling_price?: unknown
  default_selling_price?: unknown
  quantity_available?: unknown
  initial_quantity?: unknown
  low_stock_alert?: unknown
  reorder_level?: unknown
  notes?: unknown
  sales_notes?: unknown
  sku?: unknown
  is_active?: unknown
}

export type MaterialFormFields = {
  name: string
  unit: string
  sku: string | null
  sales_description: string | null
  default_cost_price: number | null
  default_selling_price: number | null
  is_billable: boolean
  sales_unit: string
  sales_notes: string | null
  quantity_on_hand: number
  reorder_level: number
  average_cost: number
  is_active: boolean
  warnings: string[]
}

function trimOrNull(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s.length > 0 ? s : null
}

function parseOptionalPrice(value: unknown, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null }
  }
  const n = Number(value)
  if (isNaN(n) || n < 0) {
    return { ok: false, error: `${label} must be a non-negative number` }
  }
  return { ok: true, value: n }
}

export function parseMaterialFormInput(
  input: MaterialFormInput,
  options?: { isCreate?: boolean }
): { ok: true; fields: MaterialFormFields } | { ok: false; error: string } {
  const warnings: string[] = []

  const name = trimOrNull(input.name)
  if (!name) {
    return { ok: false, error: "Material name is required" }
  }

  const unit = trimOrNull(input.unit)
  if (!unit) {
    return { ok: false, error: "Unit is required" }
  }

  const costParsed = parseOptionalPrice(
    input.cost_price ?? input.default_cost_price,
    "Cost price"
  )
  if (!costParsed.ok) return costParsed

  const sellParsed = parseOptionalPrice(
    input.selling_price ?? input.default_selling_price,
    "Selling price"
  )
  if (!sellParsed.ok) return sellParsed

  const qtyRaw = input.quantity_available ?? input.initial_quantity ?? 0
  const quantity_on_hand = Number(qtyRaw)
  if (isNaN(quantity_on_hand) || quantity_on_hand < 0) {
    return { ok: false, error: "Quantity available must be a non-negative number" }
  }

  const reorderRaw = input.low_stock_alert ?? input.reorder_level ?? 0
  const reorder_level = Number(reorderRaw)
  if (isNaN(reorder_level) || reorder_level < 0) {
    return { ok: false, error: "Low stock alert must be a non-negative number" }
  }

  if (quantity_on_hand > 0 && costParsed.value === null) {
    warnings.push("Cost price is missing. Stock value will show as 0 until you add a cost.")
  }

  const average_cost =
    quantity_on_hand > 0 && costParsed.value !== null ? costParsed.value : 0

  const default_selling_price = sellParsed.value
  const is_billable = default_selling_price !== null

  return {
    ok: true,
    fields: {
      name,
      unit,
      sku: trimOrNull(input.sku),
      sales_description: trimOrNull(input.description),
      default_cost_price: costParsed.value,
      default_selling_price,
      is_billable,
      sales_unit: unit,
      sales_notes: trimOrNull(input.notes ?? input.sales_notes),
      quantity_on_hand,
      reorder_level,
      average_cost,
      is_active: input.is_active === undefined ? true : Boolean(input.is_active),
      warnings,
    },
  }
}

/** Weighted average when adding stock with a unit cost. */
export function computeWeightedAverageCost(
  prevQty: number,
  prevAvg: number,
  addQty: number,
  unitCost: number | null
): number {
  if (addQty <= 0) return prevAvg
  if (unitCost === null || unitCost === undefined) return prevAvg
  const newQty = prevQty + addQty
  if (newQty <= 0) return 0
  return (prevQty * prevAvg + addQty * unitCost) / newQty
}

export function materialSalesDisplayName(row: {
  name: string
  sales_name?: string | null
}): string {
  const sn = trimOrNull(row.sales_name)
  return sn ?? row.name
}

export function materialSalesLineDescription(row: {
  name: string
  sales_name?: string | null
  sales_description?: string | null
}): string {
  const desc = trimOrNull(row.sales_description)
  if (desc) return desc
  return materialSalesDisplayName(row)
}
