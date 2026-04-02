/**
 * Line discount for estimate/quote items: prefer stored discount_amount;
 * if the column is absent, derive from qty × unit − line net (legacy rows).
 */
export function estimateLineItemDiscount(item: {
  discount_amount?: unknown
  quantity?: unknown
  qty?: unknown
  price?: unknown
  unit_price?: unknown
  total?: unknown
  line_total?: unknown
}): number {
  const raw = item.discount_amount
  if (raw != null && raw !== "" && Number.isFinite(Number(raw))) {
    const d = Math.round(Number(raw) * 100) / 100
    if (d > 0) return d
    return 0
  }
  const qty = Number(item.quantity ?? item.qty ?? 0)
  const unit = Number(item.price ?? item.unit_price ?? 0)
  const net = Number(item.total ?? item.line_total ?? 0)
  if (!Number.isFinite(qty) || !Number.isFinite(unit) || !Number.isFinite(net)) return 0
  return Math.max(0, Math.round((qty * unit - net) * 100) / 100)
}
