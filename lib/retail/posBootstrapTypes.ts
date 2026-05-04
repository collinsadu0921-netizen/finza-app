/** GET /api/retail/pos/bootstrap JSON body (PIN cashier bearer token). */
export type RetailPosBootstrapPayload = {
  business: {
    id: string
    name: string | null
    address_country: string | null
    default_currency: string | null
  }
  store: { id: string; name: string | null }
  cashier: { id: string; display_name: string | null }
  registers: Array<{ id: string; name: string; store_id: string | null }>
  open_cashier_sessions: Array<{
    id: string
    register_id: string
    user_id: string
    store_id: string | null
    started_at: string
    opening_float?: number
    registers?: { id: string; name: string } | null
    stores?: { name: string } | null
  }>
  products: Array<Record<string, unknown>>
  variant_stock_by_id: Record<string, number>
  variants: Array<{
    id: string
    product_id: string
    variant_name: string | null
    price: number | null
    stock_quantity: number | null
    stock: number | null
    barcode: string | null
    sku: string | null
  }>
  categories: Array<{ id: string; name: string; vat_type?: string | null }>
  quick_key_products: Array<Record<string, unknown>>
}
