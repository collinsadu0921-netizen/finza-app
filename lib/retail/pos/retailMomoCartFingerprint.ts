/**
 * Canonical cart fingerprint for retail MoMo sandbox attempts.
 * Same algorithm in browser (finalize) and server (validate).
 */

/** Snapshot sent to MoMo initiate; server derives `server_cart_fingerprint` from this + payable total. */
export type RetailMomoCartSnapshotItem = {
  product_id: string
  variant_id?: string | null
  quantity: number
  unit_price: number
  discount_type?: string
  discount_value?: number
}

export type RetailMomoCartSnapshot = {
  items: RetailMomoCartSnapshotItem[]
  cart_discount_type?: string
  cart_discount_value?: number
}

export type RetailMomoFingerprintLine = {
  product_id: string
  variant_id?: string | null
  quantity: number
  unit_price: number
}

export function buildRetailMomoCartFingerprint(params: {
  saleTotal: number
  lines: RetailMomoFingerprintLine[]
}): string {
  const sorted = [...params.lines]
    .map((l) => ({
      product_id: String(l.product_id),
      variant_id: l.variant_id ? String(l.variant_id) : "",
      quantity: Math.max(1, Math.floor(Number(l.quantity) || 1)),
      unit_price: Number(Number(l.unit_price).toFixed(4)),
    }))
    .sort((a, b) => {
      const pc = a.product_id.localeCompare(b.product_id)
      if (pc !== 0) return pc
      return a.variant_id.localeCompare(b.variant_id)
    })
  const total = Number(params.saleTotal.toFixed(2))
  const body = sorted
    .map((l) => `${l.product_id}:${l.variant_id}:${l.quantity}:${l.unit_price}`)
    .join(";")
  return `v1|total=${total}|${body}`
}
