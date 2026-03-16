import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

/**
 * POST /api/stock-transfers
 * Create a new stock transfer (draft status)
 */
export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json()
    const { from_store_id, to_store_id, reference, items } = body

    // Validation
    if (!from_store_id || !to_store_id) {
      return NextResponse.json(
        { error: "Missing required fields: from_store_id, to_store_id" },
        { status: 400 }
      )
    }

    if (from_store_id === to_store_id) {
      return NextResponse.json(
        { error: "from_store_id and to_store_id must be different" },
        { status: 400 }
      )
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Transfer must have at least one item" },
        { status: 400 }
      )
    }

    // Verify stores belong to business
    const { data: stores, error: storesError } = await supabase
      .from("stores")
      .select("id, name")
      .eq("business_id", business.id)
      .in("id", [from_store_id, to_store_id])

    if (storesError || !stores || stores.length !== 2) {
      return NextResponse.json(
        { error: "Invalid store IDs or stores do not belong to business" },
        { status: 400 }
      )
    }

    // Validate items and get product cost prices
    const productIds = items.map((item: any) => item.product_id).filter(Boolean)
    const variantIds = items.map((item: any) => item.variant_id).filter(Boolean)

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, cost_price")
      .in("id", productIds)
      .eq("business_id", business.id)

    if (productsError) {
      return NextResponse.json(
        { error: "Failed to load products" },
        { status: 500 }
      )
    }

    const productCostMap = new Map(
      (products || []).map((p: any) => [p.id, Number(p.cost_price || 0)])
    )

    // Load variant costs if any
    let variantCostMap = new Map<string, number>()
    if (variantIds.length > 0) {
      const { data: variants } = await supabase
        .from("products_variants")
        .select("id, cost_price")
        .in("id", variantIds)

      if (variants) {
        variantCostMap = new Map(
          variants.map((v: any) => [v.id, Number(v.cost_price || 0)])
        )
      }
    }

    // Validate items and check stock availability
    const transferItems: any[] = []
    for (const item of items) {
      const { product_id, variant_id, quantity } = item

      if (!product_id || !quantity || quantity <= 0) {
        return NextResponse.json(
          { error: "Each item must have product_id and quantity > 0" },
          { status: 400 }
        )
      }

      // Get unit cost (variant cost if variant exists, otherwise product cost)
      const unitCost = variant_id && variantCostMap.has(variant_id)
        ? variantCostMap.get(variant_id)!
        : productCostMap.get(product_id) || 0

      if (unitCost <= 0) {
        return NextResponse.json(
          { error: `Product ${product_id} has no cost price. Cannot create transfer without cost.` },
          { status: 400 }
        )
      }

      // Check stock availability at from_store
      const stockQuery = supabase
        .from("products_stock")
        .select("stock_quantity, stock")
        .eq("product_id", product_id)
        .eq("store_id", from_store_id)

      if (variant_id) {
        stockQuery.eq("variant_id", variant_id)
      } else {
        stockQuery.is("variant_id", null)
      }

      const { data: stockData, error: stockError } = await stockQuery.maybeSingle()

      if (stockError) {
        return NextResponse.json(
          { error: `Failed to check stock for product ${product_id}` },
          { status: 500 }
        )
      }

      const availableStock = stockData
        ? Number(stockData.stock_quantity || stockData.stock || 0)
        : 0

      if (availableStock < quantity) {
        return NextResponse.json(
          {
            error: `Insufficient stock for product ${product_id}${variant_id ? ` (variant ${variant_id})` : ""}. Available: ${availableStock}, Requested: ${quantity}`,
          },
          { status: 400 }
        )
      }

      transferItems.push({
        product_id,
        variant_id: variant_id || null,
        quantity: Number(quantity),
        unit_cost: unitCost,
        total_cost: Number(quantity) * unitCost,
      })
    }

    // Create transfer (draft status)
    const { data: transfer, error: transferError } = await supabase
      .from("stock_transfers")
      .insert({
        business_id: business.id,
        from_store_id,
        to_store_id,
        status: "draft",
        reference: reference || null,
        initiated_by: user.id,
        initiated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (transferError || !transfer) {
      console.error("Error creating transfer:", transferError)
      return NextResponse.json(
        { error: "Failed to create transfer" },
        { status: 500 }
      )
    }

    // Create transfer items
    const itemsToInsert = transferItems.map((item) => ({
      stock_transfer_id: transfer.id,
      ...item,
    }))

    const { data: insertedItems, error: itemsError } = await supabase
      .from("stock_transfer_items")
      .insert(itemsToInsert)
      .select()

    if (itemsError) {
      // Rollback: delete transfer if items insert fails
      await supabase.from("stock_transfers").delete().eq("id", transfer.id)
      console.error("Error creating transfer items:", itemsError)
      return NextResponse.json(
        { error: "Failed to create transfer items" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      transfer: {
        ...transfer,
        items: insertedItems,
      },
    })
  } catch (error: any) {
    console.error("Error in POST /api/stock-transfers:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/stock-transfers
 * List stock transfers for the business
 */
export async function GET(request: NextRequest) {
  try {
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

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const storeId = searchParams.get("store_id")

    let query = supabase
      .from("stock_transfers")
      .select(`
        *,
        from_store:stores!stock_transfers_from_store_id_fkey(id, name),
        to_store:stores!stock_transfers_to_store_id_fkey(id, name),
        initiated_by_user:users!stock_transfers_initiated_by_fkey(id, full_name, email),
        received_by_user:users!stock_transfers_received_by_fkey(id, full_name, email),
        items:stock_transfer_items(*)
      `)
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })

    if (status) {
      query = query.eq("status", status)
    }

    if (storeId) {
      query = query.or(`from_store_id.eq.${storeId},to_store_id.eq.${storeId}`)
    }

    const { data: transfers, error } = await query

    if (error) {
      console.error("Error loading transfers:", error)
      return NextResponse.json(
        { error: "Failed to load transfers" },
        { status: 500 }
      )
    }

    return NextResponse.json({ transfers: transfers || [] })
  } catch (error: any) {
    console.error("Error in GET /api/stock-transfers:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
