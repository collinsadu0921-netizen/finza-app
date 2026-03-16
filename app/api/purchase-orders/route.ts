import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * POST /api/purchase-orders
 * Create a new purchase order (draft status)
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const { supplier_id, reference, order_date, expected_date, items } = body

    // Validation
    if (!supplier_id) {
      return NextResponse.json(
        { error: "Missing required field: supplier_id" },
        { status: 400 }
      )
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Purchase order must have at least one item" },
        { status: 400 }
      )
    }

    // Verify supplier belongs to business
    const { data: supplier, error: supplierError } = await supabase
      .from("suppliers")
      .select("id, name, status")
      .eq("id", supplier_id)
      .eq("business_id", business.id)
      .single()

    if (supplierError || !supplier) {
      return NextResponse.json(
        { error: "Invalid supplier ID or supplier does not belong to business" },
        { status: 400 }
      )
    }

    if (supplier.status === "blocked") {
      return NextResponse.json(
        { error: "Cannot create purchase order for blocked supplier" },
        { status: 400 }
      )
    }

    // Validate items
    const poItems: any[] = []
    for (const item of items) {
      const { product_id, variant_id, quantity, unit_cost } = item

      if (!product_id || !quantity || quantity <= 0) {
        return NextResponse.json(
          { error: "Each item must have product_id and quantity > 0" },
          { status: 400 }
        )
      }

      if (!unit_cost || unit_cost < 0) {
        return NextResponse.json(
          { error: "Each item must have unit_cost >= 0" },
          { status: 400 }
        )
      }

      // Verify product exists
      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id")
        .eq("id", product_id)
        .eq("business_id", business.id)
        .single()

      if (productError || !product) {
        return NextResponse.json(
          { error: `Product ${product_id} not found or does not belong to business` },
          { status: 400 }
        )
      }

      poItems.push({
        product_id,
        variant_id: variant_id || null,
        quantity: Number(quantity),
        unit_cost: Number(unit_cost),
        total_cost: Number(quantity) * Number(unit_cost),
      })
    }

    // Create purchase order (draft status)
    const { data: purchaseOrder, error: poError } = await supabase
      .from("purchase_orders")
      .insert({
        business_id: business.id,
        supplier_id,
        status: "draft",
        reference: reference || null,
        order_date: order_date || new Date().toISOString().split("T")[0],
        expected_date: expected_date || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (poError || !purchaseOrder) {
      console.error("Error creating purchase order:", poError)
      return NextResponse.json(
        { error: "Failed to create purchase order" },
        { status: 500 }
      )
    }

    // Create PO items
    const itemsToInsert = poItems.map((item) => ({
      purchase_order_id: purchaseOrder.id,
      ...item,
    }))

    const { data: insertedItems, error: itemsError } = await supabase
      .from("purchase_order_items")
      .insert(itemsToInsert)
      .select()

    if (itemsError) {
      // Rollback: delete PO if items insert fails
      await supabase.from("purchase_orders").delete().eq("id", purchaseOrder.id)
      console.error("Error creating PO items:", itemsError)
      return NextResponse.json(
        { error: "Failed to create purchase order items" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      purchase_order: {
        ...purchaseOrder,
        items: insertedItems,
      },
    })
  } catch (error: any) {
    console.error("Error in POST /api/purchase-orders:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/purchase-orders
 * List purchase orders for the business
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

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const supplierId = searchParams.get("supplier_id")

    let query = supabase
      .from("purchase_orders")
      .select(`
        *,
        supplier:suppliers(id, name),
        created_by_user:users!purchase_orders_created_by_fkey(id, full_name, email),
        received_by_user:users!purchase_orders_received_by_fkey(id, full_name, email),
        items:purchase_order_items(*)
      `)
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })

    if (status) {
      query = query.eq("status", status)
    }

    if (supplierId) {
      query = query.eq("supplier_id", supplierId)
    }

    const { data: purchaseOrders, error } = await query

    if (error) {
      console.error("Error loading purchase orders:", error)
      return NextResponse.json(
        { error: "Failed to load purchase orders" },
        { status: 500 }
      )
    }

    return NextResponse.json({ purchase_orders: purchaseOrders || [] })
  } catch (error: any) {
    console.error("Error in GET /api/purchase-orders:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
