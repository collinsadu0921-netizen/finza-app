import "server-only"

import {
  allocateCartDiscount,
  calculateDiscounts,
  type CartDiscount,
  type LineItem,
} from "@/lib/discounts/calculator"
import {
  buildRetailMomoCartFingerprint,
  type RetailMomoCartSnapshot,
  type RetailMomoFingerprintLine,
} from "@/lib/retail/pos/retailMomoCartFingerprint"

export type { RetailMomoCartSnapshot, RetailMomoCartSnapshotItem } from "@/lib/retail/pos/retailMomoCartFingerprint"

/**
 * Deterministic fingerprint: net unit after line + proportional cart discount,
 * with `saleTotal` equal to the committed tax-inclusive payable (must match initiate/finalize `amount`).
 */
export function computeServerRetailMomoFingerprint(
  snapshot: RetailMomoCartSnapshot,
  committedTotalGhs: number
): string {
  const lineItemsForDiscount: LineItem[] = (snapshot.items ?? []).map((item) => ({
    quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
    unit_price: Number(item.unit_price),
    discount:
      item.discount_type && item.discount_type !== "none"
        ? {
            discount_type: item.discount_type as "percent" | "amount",
            discount_value: Number(item.discount_value || 0),
          }
        : undefined,
  }))

  const cartDiscount: CartDiscount | undefined =
    snapshot.cart_discount_type && snapshot.cart_discount_type !== "none"
      ? {
          discount_type: snapshot.cart_discount_type as "percent" | "amount",
          discount_value: Number(snapshot.cart_discount_value || 0),
        }
      : undefined

  const discountResult = calculateDiscounts(lineItemsForDiscount, cartDiscount)
  const allocations = allocateCartDiscount(
    discountResult.lineItems.map((l) => ({ net_line: l.net_line })),
    discountResult.cart_discount_amount,
    discountResult.subtotal_after_line_discounts
  )

  const lines: RetailMomoFingerprintLine[] = (snapshot.items ?? []).map((item, i) => {
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1))
    const netLine = discountResult.lineItems[i]?.net_line ?? qty * Number(item.unit_price)
    const alloc = allocations[i] ?? 0
    const finalNetLine = Math.max(0, netLine - alloc)
    const netUnit = qty > 0 ? finalNetLine / qty : 0
    return {
      product_id: String(item.product_id),
      variant_id: item.variant_id ?? null,
      quantity: qty,
      unit_price: Number(netUnit.toFixed(4)),
    }
  })

  return buildRetailMomoCartFingerprint({
    saleTotal: Number(Number(committedTotalGhs).toFixed(2)),
    lines,
  })
}
