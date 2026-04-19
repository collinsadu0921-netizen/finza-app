export type RetailLowStockRow = {
  product_id: string
  name: string
  barcode: string | null
  current_stock: number
  threshold: number
  status: "low_stock" | "out_of_stock"
  suggested_order_qty: number
  /** When set, this row is a variant SKU; buy lists / PO lines should send this variant_id */
  variant_id?: string | null
  variant_name?: string | null
}
