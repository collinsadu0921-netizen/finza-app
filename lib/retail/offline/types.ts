/**
 * Retail POS offline catalog (Dexie) — minimal types for Phase 1 snapshot only.
 * Kept separate from `RetailPosPage` to avoid circular imports.
 */

export type RetailPosOfflineVariantRow = {
  id: string
  product_id: string
  variant_name: string
  price: number | null
  stock_quantity: number | null
  stock: number | null
  barcode: string | null
  sku: string | null
}

/** v1 payload stored as JSON in IndexedDB (Dexie). */
export type RetailPosOfflineCatalogPayloadV1 = {
  schemaVersion: 1
  businessId: string
  storeId: string
  /** Store display name at sync time (for header when offline). */
  storeLabel?: string | null
  lastSyncedAt: string
  /** POS `Product[]` serialized */
  products: unknown[]
  /** POS `Category[]` serialized */
  categories: unknown[]
  variantStockById: Record<string, number>
  /** Variant rows for barcode / SKU resolution offline */
  variants: RetailPosOfflineVariantRow[]
  /** Quick-key strip */
  quickKeys: unknown[]
  currencyCode: string | null
  businessCountry: string | null
  retailVatInclusive: boolean
}

export function isRetailPosOfflineCatalogPayloadV1(x: unknown): x is RetailPosOfflineCatalogPayloadV1 {
  if (!x || typeof x !== "object") return false
  const o = x as Record<string, unknown>
  return o.schemaVersion === 1 && typeof o.businessId === "string" && typeof o.storeId === "string"
}
