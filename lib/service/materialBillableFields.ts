/**
 * Validation and normalization for billable fields on service_material_inventory.
 * average_cost is inventory cost only; default_selling_price is customer-facing.
 */

export type MaterialBillableFields = {
  is_billable: boolean
  sales_name: string | null
  sales_description: string | null
  default_selling_price: number | null
  sales_unit: string | null
  sales_tax_code: string | null
  sales_notes: string | null
}

export type MaterialBillableInput = {
  is_billable?: unknown
  sales_name?: unknown
  sales_description?: unknown
  default_selling_price?: unknown
  sales_unit?: unknown
  sales_tax_code?: unknown
  sales_notes?: unknown
}

function trimOrNull(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s.length > 0 ? s : null
}

export function parseMaterialBillableFields(
  input: MaterialBillableInput,
  options?: { stockUnit?: string | null; requireBillablePrice?: boolean }
): { ok: true; fields: MaterialBillableFields } | { ok: false; error: string } {
  const is_billable = Boolean(input.is_billable)
  const sales_name = trimOrNull(input.sales_name)
  const sales_description = trimOrNull(input.sales_description)
  const sales_unit_raw = trimOrNull(input.sales_unit)
  const sales_tax_code = trimOrNull(input.sales_tax_code)
  const sales_notes = trimOrNull(input.sales_notes)

  let default_selling_price: number | null = null
  if (input.default_selling_price !== undefined && input.default_selling_price !== null && input.default_selling_price !== "") {
    const price = Number(input.default_selling_price)
    if (isNaN(price) || price < 0) {
      return { ok: false, error: "default_selling_price must be a non-negative number" }
    }
    default_selling_price = price
  }

  const requirePrice = options?.requireBillablePrice !== false && is_billable
  if (requirePrice && default_selling_price === null) {
    return { ok: false, error: "default_selling_price is required when material is billable" }
  }

  const stockUnit = trimOrNull(options?.stockUnit ?? null)
  const sales_unit = sales_unit_raw ?? (is_billable ? stockUnit : null)

  if (is_billable && !sales_unit) {
    return { ok: false, error: "sales_unit is required when material is billable (set stock unit or sales unit)" }
  }

  return {
    ok: true,
    fields: {
      is_billable,
      sales_name,
      sales_description,
      default_selling_price: is_billable ? default_selling_price : default_selling_price,
      sales_unit: is_billable ? sales_unit : sales_unit_raw,
      sales_tax_code,
      sales_notes,
    },
  }
}

/** Customer-facing display name for billable list / future line pickers. */
export function materialSalesDisplayName(row: {
  name: string
  sales_name?: string | null
}): string {
  const sn = trimOrNull(row.sales_name)
  return sn ?? row.name
}

/** Description snapshotted onto document lines when a material is selected. */
export function materialSalesLineDescription(row: {
  name: string
  sales_name?: string | null
  sales_description?: string | null
}): string {
  const desc = trimOrNull(row.sales_description)
  if (desc) return desc
  return materialSalesDisplayName(row)
}
