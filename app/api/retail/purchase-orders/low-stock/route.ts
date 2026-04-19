import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getStockStatus } from "@/lib/inventory"
import type { RetailLowStockRow } from "@/lib/retail/purchaseOrdersLowStock"

function floorStock(
  row: { stock_quantity?: number | null; stock?: number | null }
): number {
  return Math.floor(
    row.stock_quantity != null
      ? Number(row.stock_quantity)
      : row.stock != null
        ? Number(row.stock)
        : 0
  )
}

/**
 * GET /api/retail/purchase-orders/low-stock?store_id=<uuid>
 * Products at or below low-stock threshold for the buy-list / restock UI.
 * Variant products: one row per variant SKU (parent/base stock is ignored for low-stock).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    if (business.industry !== "retail") {
      return NextResponse.json({ error: "Retail only" }, { status: 403 })
    }

    const storeId = request.nextUrl.searchParams.get("store_id")

    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select("id, name, barcode, stock_quantity, stock, low_stock_threshold, track_stock")
      .eq("business_id", business.id)
      .order("name", { ascending: true })

    if (productsError) {
      return NextResponse.json({ error: productsError.message }, { status: 500 })
    }

    const products = productsData || []
    if (products.length === 0) {
      return NextResponse.json({ items: [] as RetailLowStockRow[] })
    }

    const productIds = products.map((p: { id: string }) => p.id)

    const { data: variantsData } = await supabase
      .from("products_variants")
      .select("id, product_id, variant_name, barcode")
      .in("product_id", productIds)

    const variantsByProduct = new Map<
      string,
      Array<{ id: string; variant_name: string; barcode: string | null }>
    >()
    const productIdsWithVariants = new Set<string>()
    for (const v of variantsData || []) {
      productIdsWithVariants.add(v.product_id)
      if (!variantsByProduct.has(v.product_id)) {
        variantsByProduct.set(v.product_id, [])
      }
      variantsByProduct.get(v.product_id)!.push({
        id: v.id,
        variant_name: v.variant_name,
        barcode: v.barcode ?? null,
      })
    }

    let stockQuery = supabase
      .from("products_stock")
      .select("product_id, variant_id, stock, stock_quantity, store_id")
      .in("product_id", productIds)

    if (storeId) {
      stockQuery = stockQuery.eq("store_id", storeId)
    }

    const { data: stockData } = await stockQuery

    const parentStockMap: Record<string, number> = {}
    const variantStockMap: Record<string, number> = {}
    if (stockData) {
      for (const s of stockData as Array<{
        product_id: string
        variant_id: string | null
        stock: number | null
        stock_quantity: number | null
      }>) {
        const qty = floorStock(s)
        if (s.variant_id) {
          variantStockMap[s.variant_id] = (variantStockMap[s.variant_id] || 0) + qty
        } else {
          parentStockMap[s.product_id] = (parentStockMap[s.product_id] || 0) + qty
        }
      }
    }

    const items: RetailLowStockRow[] = []

    for (const p of products as Array<{
      id: string
      name: string
      barcode?: string | null
      stock_quantity?: number | null
      stock?: number | null
      low_stock_threshold?: number | null
      track_stock?: boolean | null
    }>) {
      const threshold =
        p.low_stock_threshold != null && !Number.isNaN(Number(p.low_stock_threshold))
          ? Number(p.low_stock_threshold)
          : 5
      const tracked = p.track_stock !== false

      if (productIdsWithVariants.has(p.id)) {
        const variantList = variantsByProduct.get(p.id) || []
        for (const v of variantList) {
          const currentStock = Math.floor(variantStockMap[v.id] ?? 0)
          const st = getStockStatus(currentStock, threshold, tracked)
          if (st.status !== "low_stock" && st.status !== "out_of_stock") continue
          const suggested = Math.max(1, Math.ceil(Math.max(threshold, 1) * 2 - currentStock))
          items.push({
            product_id: p.id,
            name: `${p.name} · ${v.variant_name}`,
            barcode: v.barcode ?? p.barcode ?? null,
            current_stock: currentStock,
            threshold,
            status: st.status as "low_stock" | "out_of_stock",
            suggested_order_qty: suggested,
            variant_id: v.id,
            variant_name: v.variant_name,
          })
        }
        continue
      }

      const currentStock = Math.floor(
        parentStockMap[p.id] !== undefined
          ? parentStockMap[p.id]
          : p.stock_quantity != null
            ? Number(p.stock_quantity)
            : p.stock != null
              ? Number(p.stock)
              : 0
      )

      const st = getStockStatus(currentStock, threshold, tracked)
      if (st.status !== "low_stock" && st.status !== "out_of_stock") continue

      const suggested = Math.max(1, Math.ceil(Math.max(threshold, 1) * 2 - currentStock))

      items.push({
        product_id: p.id,
        name: p.name,
        barcode: p.barcode ?? null,
        current_stock: currentStock,
        threshold,
        status: st.status as "low_stock" | "out_of_stock",
        suggested_order_qty: suggested,
        variant_id: null,
      })
    }

    items.sort((a, b) => {
      if (a.status === "out_of_stock" && b.status !== "out_of_stock") return -1
      if (a.status !== "out_of_stock" && b.status === "out_of_stock") return 1
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({ items })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
