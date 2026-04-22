/**
 * Request lines may send `product_service_id` or legacy `product_id` (products_services row id).
 * Returns null when absent so callers can omit the column or set null consistently.
 */
export function pickEstimateItemProductServiceId(item: {
  product_service_id?: unknown
  product_id?: unknown
}): string | null {
  const v = item.product_service_id ?? item.product_id
  if (v == null || v === "") return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}
