import {
  materialSalesDisplayName,
  materialSalesLineDescription,
} from "@/lib/service/materialFormFields"

/** DB row shape for billable-list query (no cost fields). */
export type BillableMaterialInventoryRow = {
  id: string
  name: string
  sales_name?: string | null
  sales_description?: string | null
  unit: string
  sales_unit?: string | null
  default_selling_price: number | null
  sales_tax_code?: string | null
  quantity_on_hand: number
  is_active?: boolean
  is_billable?: boolean
}

export type BillableMaterialListItem = {
  id: string
  name: string
  description: string
  unit: string
  sellingPrice: number
  taxCode: string | null
  quantityAvailable: number
}

const FORBIDDEN_RESPONSE_KEYS = new Set([
  "average_cost",
  "default_cost_price",
  "sales_notes",
  "sku",
  "reorder_level",
])

export function isBillableMaterialRow(row: BillableMaterialInventoryRow): boolean {
  if (row.is_active === false) return false
  if (row.is_billable === false) return false
  const price = row.default_selling_price
  if (price == null) return false
  const n = Number(price)
  return !isNaN(n) && n >= 0
}

export function mapBillableMaterialRow(row: BillableMaterialInventoryRow): BillableMaterialListItem {
  const unit = (row.sales_unit?.trim() || row.unit?.trim() || "").trim()
  const sellingPrice = Number(row.default_selling_price ?? 0)
  const item: BillableMaterialListItem = {
    id: row.id,
    name: materialSalesDisplayName(row),
    description: materialSalesLineDescription(row),
    unit: unit || row.unit,
    sellingPrice,
    taxCode: row.sales_tax_code?.trim() ? row.sales_tax_code.trim() : null,
    quantityAvailable: Number(row.quantity_on_hand ?? 0),
  }

  for (const key of FORBIDDEN_RESPONSE_KEYS) {
    if (key in (item as unknown as Record<string, unknown>)) {
      throw new Error(`Billable list must not expose ${key}`)
    }
  }

  return item
}

export function mapBillableMaterialRows(
  rows: BillableMaterialInventoryRow[]
): BillableMaterialListItem[] {
  return rows.filter(isBillableMaterialRow).map(mapBillableMaterialRow)
}

/** Escape user search for PostgREST .or() ilike filters (matches workspace pattern). */
export function sanitizeBillableListSearchQuery(q: string): string {
  return q.replace(/[%_,]/g, " ").trim()
}

export function parseBillableListLimit(raw: string | null): number {
  const n = Number.parseInt(raw ?? "50", 10)
  if (!Number.isFinite(n) || n < 1) return 50
  return Math.min(100, n)
}
