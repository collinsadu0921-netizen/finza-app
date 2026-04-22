import type { SupabaseClient } from "@supabase/supabase-js"

export type InventoryCategory = {
  id: string
  name: string
}

export type InventoryProduct = {
  id: string
  name: string
  price: number
  stock: number
  stock_quantity?: number
  low_stock_threshold?: number
  track_stock?: boolean
  category_id?: string
  hasVariants?: boolean
  variants?: Array<{
    id: string
    variant_name: string
    stock: number
    price?: number
  }>
}

/** Page size for inventory list (products + stock for visible slice only). */
export const DEFAULT_RETAIL_INVENTORY_PAGE_SIZE = 50

export type LoadRetailInventoryPageOptions = {
  /** Zero-based page index. */
  page: number
  pageSize: number
  /** When set, only products in this category (server-side). `null` = all categories. */
  categoryId: string | null
}

export type LoadRetailInventoryPageResult = {
  categories: InventoryCategory[]
  products: InventoryProduct[]
  /** Total products matching business + optional category filter (not page size). */
  totalProductCount: number
}

type ProductDbRow = {
  id: string
  name: string
  price: number | string | null
  low_stock_threshold?: number | string | null
  track_stock?: boolean | null
  category_id?: string | null
}

function throwIfError(context: string, error: { message?: string; code?: string } | null) {
  if (error) {
    const err = new Error(error.message || "Request failed")
    ;(err as Error & { code?: string; context?: string }).code = error.code
    ;(err as Error & { context?: string }).context = context
    throw err
  }
}

/**
 * Loads categories (full list) + one page of products + stock + variants for that page only.
 * Throws on any Supabase error so callers can surface failures.
 */
export async function loadRetailInventoryPageData(
  supabase: SupabaseClient,
  businessId: string,
  activeStoreId: string,
  options: LoadRetailInventoryPageOptions
): Promise<LoadRetailInventoryPageResult> {
  const { page, pageSize, categoryId } = options
  const safePageSize = Math.max(1, Math.min(200, Math.floor(pageSize)))
  const offset = Math.max(0, page) * safePageSize
  const lastIndex = offset + safePageSize - 1

  const { data: cats, error: catsErr } = await supabase
    .from("categories")
    .select("id, name")
    .eq("business_id", businessId)
    .order("name", { ascending: true })

  throwIfError("inventory.categories", catsErr)

  let productsQuery = supabase
    .from("products")
    .select("id, name, price, low_stock_threshold, track_stock, category_id", { count: "exact" })
    .eq("business_id", businessId)
    .order("name", { ascending: true })

  if (categoryId) {
    productsQuery = productsQuery.eq("category_id", categoryId)
  }

  const {
    data: prods,
    error: prodsErr,
    count: totalCountRaw,
  } = await productsQuery.range(offset, lastIndex)

  throwIfError("inventory.products", prodsErr)

  const totalProductCount = typeof totalCountRaw === "number" ? totalCountRaw : 0
  const productRows = (prods || []) as ProductDbRow[]

  if (productRows.length === 0) {
    return { categories: cats || [], products: [], totalProductCount }
  }

  const productIds = productRows.map((p) => p.id)

  const { data: stockData, error: stockErr } = await supabase
    .from("products_stock")
    .select("product_id, variant_id, stock")
    .eq("store_id", activeStoreId)
    .is("variant_id", null)
    .in("product_id", productIds)

  throwIfError("inventory.products_stock", stockErr)

  const stockMap = new Map<string, number>()
  for (const record of stockData || []) {
    stockMap.set(record.product_id, Number(record.stock || 0))
  }

  const productsWithVariants = new Set<string>()
  const productVariantsMap = new Map<string, Array<{ id: string; variant_name: string; price?: number }>>()

  const { data: variantsData, error: variantsErr } = await supabase
    .from("products_variants")
    .select("id, product_id, variant_name, price")
    .in("product_id", productIds)

  throwIfError("inventory.products_variants", variantsErr)

  for (const v of variantsData || []) {
    productsWithVariants.add(v.product_id)
    if (!productVariantsMap.has(v.product_id)) {
      productVariantsMap.set(v.product_id, [])
    }
    productVariantsMap.get(v.product_id)!.push({
      id: v.id,
      variant_name: v.variant_name,
      price: v.price != null ? Number(v.price) : undefined,
    })
  }

  const variantStockMap = new Map<string, number>()
  if (productsWithVariants.size > 0) {
    const variantIds = Array.from(productVariantsMap.values())
      .flat()
      .map((v) => v.id)
    if (variantIds.length > 0) {
      const { data: variantStockData, error: variantStockErr } = await supabase
        .from("products_stock")
        .select("variant_id, stock")
        .eq("store_id", activeStoreId)
        .in("variant_id", variantIds)
        .not("variant_id", "is", null)

      throwIfError("inventory.products_stock_variants", variantStockErr)

      for (const record of variantStockData || []) {
        variantStockMap.set(record.variant_id, Number(record.stock || 0))
      }
    }
  }

  const inventoryProducts: InventoryProduct[] = productRows.map((p) => {
    const storeStock = stockMap.get(p.id) ?? 0
    const stockQty = Math.floor(storeStock)
    const hasVariants = productsWithVariants.has(p.id)

    let variants: Array<{ id: string; variant_name: string; stock: number; price?: number }> | undefined
    if (hasVariants) {
      const variantList = productVariantsMap.get(p.id) || []
      variants = variantList.map((v) => ({
        ...v,
        stock: Math.floor(variantStockMap.get(v.id) ?? 0),
      }))
    }

    return {
      id: p.id,
      name: p.name,
      price: Number(p.price),
      stock: stockQty,
      stock_quantity: stockQty,
      low_stock_threshold: p.low_stock_threshold != null ? Number(p.low_stock_threshold) : undefined,
      track_stock: p.track_stock !== undefined && p.track_stock !== null ? p.track_stock : true,
      category_id: p.category_id || undefined,
      hasVariants,
      variants,
    }
  })

  return { categories: cats || [], products: inventoryProducts, totalProductCount }
}
