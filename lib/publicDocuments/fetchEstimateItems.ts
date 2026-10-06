import type { SupabaseClient } from "@supabase/supabase-js"

/** Columns written by current quote saves (`quantity` / `price` / `total`). */
export const ESTIMATE_ITEM_SELECT_LEGACY =
  "id, description, quantity, price, total, discount_amount, created_at"

/** Columns added by migration 034. Not combined with the legacy select. */
export const ESTIMATE_ITEM_SELECT_CURRENT =
  "id, description, qty, unit_price, line_total, discount_amount, created_at"

export type NormalizedEstimateItem = {
  id: string
  description: string
  quantity: number
  unitPrice: number
  discountAmount: number
  lineTotal: number
  createdAt: string | null
}

export type EstimateItemLoadResult =
  | { ok: true; items: NormalizedEstimateItem[]; columnVariant: "current" | "legacy" }
  | { ok: false; error: string }

type ItemQueryError = { message?: string; code?: string; details?: string; hint?: string } | null

export function isEstimateItemSchemaMismatch(error: ItemQueryError): boolean {
  if (!error) return false
  const code = String(error.code || "")
  const msg = String(error.message || "")
  return (
    code === "42703" ||
    code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("Could not find")
  )
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function normalizeEstimateItemRow(row: Record<string, unknown>): NormalizedEstimateItem {
  const quantity = num(row.quantity ?? row.qty)
  const unitPrice = num(row.price ?? row.unit_price)
  const discountAmount = num(row.discount_amount)
  const storedLine = row.total ?? row.line_total
  const lineTotal =
    storedLine != null
      ? num(storedLine)
      : Math.round(Math.max(0, quantity * unitPrice - discountAmount) * 100) / 100
  return {
    id: String(row.id ?? ""),
    description: typeof row.description === "string" ? row.description : "",
    quantity,
    unitPrice,
    discountAmount,
    lineTotal: Math.round(lineTotal * 100) / 100,
    createdAt: row.created_at != null ? String(row.created_at) : null,
  }
}

/** Shape expected by the public quote page (`quantity` / `price` / `total`). */
export function estimateItemForPublicJson(item: NormalizedEstimateItem) {
  return {
    id: item.id,
    description: item.description,
    quantity: item.quantity,
    price: item.unitPrice,
    total: item.lineTotal,
    discount_amount: item.discountAmount,
    qty: item.quantity,
    unit_price: item.unitPrice,
    line_total: item.lineTotal,
  }
}

/** Shape consumed by `buildEstimateFinancialDocumentHtmlForPdf`. */
export function estimateItemForPdf(item: NormalizedEstimateItem) {
  return {
    id: item.id,
    description: item.description,
    quantity: item.quantity,
    qty: item.quantity,
    price: item.unitPrice,
    unit_price: item.unitPrice,
    discount_amount: item.discountAmount,
    total: item.lineTotal,
    line_total: item.lineTotal,
  }
}

async function selectItems(
  supabase: SupabaseClient,
  estimateId: string,
  columns: string
): Promise<{ data: Record<string, unknown>[] | null; error: ItemQueryError }> {
  const { data, error } = await supabase
    .from("estimate_items")
    .select(columns)
    .eq("estimate_id", estimateId)
    .order("created_at", { ascending: true })
  return {
    data: (data as Record<string, unknown>[] | null) ?? null,
    error: error as ItemQueryError,
  }
}

/**
 * Load quote lines with one schema shape at a time.
 * A missing-column error tries the other shape. Any other error stops.
 * An empty successful result is a quote with no lines, not a failed query.
 */
export async function fetchNormalizedEstimateItems(
  supabase: SupabaseClient,
  estimateId: string
): Promise<EstimateItemLoadResult> {
  const attempts: { columnVariant: "current" | "legacy"; columns: string }[] = [
    { columnVariant: "current", columns: ESTIMATE_ITEM_SELECT_CURRENT },
    { columnVariant: "legacy", columns: ESTIMATE_ITEM_SELECT_LEGACY },
  ]

  let lastSchemaError: ItemQueryError = null

  for (const attempt of attempts) {
    const { data, error } = await selectItems(supabase, estimateId, attempt.columns)
    if (!error) {
      return {
        ok: true,
        columnVariant: attempt.columnVariant,
        items: (data ?? []).map((row) => normalizeEstimateItemRow(row)),
      }
    }
    if (!isEstimateItemSchemaMismatch(error)) {
      return { ok: false, error: error.message || "Could not load quote line items" }
    }
    lastSchemaError = error
  }

  return {
    ok: false,
    error: lastSchemaError?.message || "Could not load quote line items",
  }
}
