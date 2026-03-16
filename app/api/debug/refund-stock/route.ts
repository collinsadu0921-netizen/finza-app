import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// Service role client for database operations
const getServiceRoleClient = () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Service role key required")
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const saleId = searchParams.get("sale_id")

    if (!saleId) {
      return NextResponse.json(
        { error: "sale_id parameter required" },
        { status: 400 }
      )
    }

    const serviceRoleClient = getServiceRoleClient()

    // 1. Get sale details
    const { data: sale, error: saleError } = await serviceRoleClient
      .from("sales")
      .select("id, payment_status, store_id, created_at")
      .eq("id", saleId)
      .single()

    if (saleError || !sale) {
      return NextResponse.json(
        { error: "Sale not found", details: saleError },
        { status: 404 }
      )
    }

    // 2. Get sale items
    const { data: saleItems, error: itemsError } = await serviceRoleClient
      .from("sale_items")
      .select("id, product_id, variant_id, qty, store_id")
      .eq("sale_id", saleId)

    if (itemsError) {
      return NextResponse.json(
        { error: "Failed to fetch sale items", details: itemsError },
        { status: 500 }
      )
    }

    // 3. Get stock movements
    const { data: movements, error: movementsError } = await serviceRoleClient
      .from("stock_movements")
      .select("id, type, quantity_change, product_id, variant_id, store_id, created_at")
      .eq("related_sale_id", saleId)
      .order("created_at")

    if (movementsError) {
      return NextResponse.json(
        { error: "Failed to fetch stock movements", details: movementsError },
        { status: 500 }
      )
    }

    // 4. Get products_stock for each product in the sale
    const productStockData: any[] = []
    if (saleItems && saleItems.length > 0) {
      for (const item of saleItems) {
        // NOTE: sale_items table does NOT have store_id column - use sale.store_id only
        const itemStoreId = sale.store_id

        if (itemStoreId) {
          let stock: any = null

          if (item.variant_id) {
            // Query for variant stock
            const { data: variantStock } = await serviceRoleClient
              .from("products_stock")
              .select("id, product_id, variant_id, store_id, stock, stock_quantity, created_at")
              .eq("product_id", item.product_id)
              .eq("variant_id", item.variant_id)
              .eq("store_id", itemStoreId)
              .maybeSingle()
            stock = variantStock
          } else {
            // Query for product stock (no variant)
            const { data: productStock } = await serviceRoleClient
              .from("products_stock")
              .select("id, product_id, variant_id, store_id, stock, stock_quantity, created_at")
              .eq("product_id", item.product_id)
              .is("variant_id", null)
              .eq("store_id", itemStoreId)
              .maybeSingle()
            stock = productStock
          }

          if (stock) {
            productStockData.push({
              ...stock,
              item_qty: item.qty,
              sale_store_id: sale.store_id,
            })
          } else {
            // Stock record not found
            productStockData.push({
              product_id: item.product_id,
              variant_id: item.variant_id,
              store_id: itemStoreId,
              stock: null,
              stock_quantity: null,
              note: "Stock record not found",
              item_qty: item.qty,
              sale_store_id: sale.store_id,
            })
          }
        }
      }
    }

    return NextResponse.json({
      sale: {
        id: sale.id,
        payment_status: sale.payment_status,
        store_id: sale.store_id,
        created_at: sale.created_at,
      },
      sale_items: saleItems || [],
      stock_movements: movements || [],
      products_stock: productStockData,
      analysis: {
        has_refund_movement: movements?.some((m: any) => m.type === "refund") || false,
        has_sale_movement: movements?.some((m: any) => m.type === "sale") || false,
        movement_count: movements?.length || 0,
        stock_records_found: productStockData.length,
        store_id_match: saleItems?.every((item: any) => {
          const itemStoreId = sale.store_id || item.store_id
          return itemStoreId === sale.store_id
        }) || false,
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

