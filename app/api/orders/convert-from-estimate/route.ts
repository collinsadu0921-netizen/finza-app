import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"

/**
 * Convert an estimate directly to an order
 * This is a convenience endpoint that wraps the create order logic
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
    const { estimateId } = body

    if (!estimateId) {
      return NextResponse.json(
        { error: "estimateId is required" },
        { status: 400 }
      )
    }

    const { data: estimate, error: estimateError } = await supabase
      .from("estimates")
      .select("*")
      .eq("id", estimateId)
      .eq("business_id", business.id)
      .single()

    if (estimateError || !estimate) {
      return NextResponse.json(
        { error: "Estimate not found" },
        { status: 404 }
      )
    }

    // Check if estimate has already been converted
    if (estimate.converted_to) {
      return NextResponse.json(
        { error: `This estimate has already been converted to ${estimate.converted_to}. An estimate can only be converted once.` },
        { status: 400 }
      )
    }

    // Fetch estimate items
    const { data: estimateItems, error: itemsError } = await supabase
      .from("estimate_items")
      .select("*")
      .eq("estimate_id", estimateId)

    if (itemsError) {
      console.error("Error fetching estimate items:", itemsError)
      return NextResponse.json(
        { error: "Failed to load estimate items" },
        { status: 500 }
      )
    }

    if (!estimateItems || estimateItems.length === 0) {
      return NextResponse.json(
        { error: "Estimate has no items" },
        { status: 400 }
      )
    }

    // Map estimate_items to order_items format
    const items = estimateItems.map((item: any) => ({
      product_service_id: item.product_service_id || null,
      description: item.description || "",
      quantity: Number(item.qty || item.quantity || 0),
      unit_price: Number(item.unit_price || item.price || 0),
    }))

    // Calculate totals
    const subtotal = estimateItems.reduce((sum: number, item: any) => {
      const qty = Number(item.qty || item.quantity || 0)
      const price = Number(item.unit_price || item.price || 0)
      return sum + qty * price
    }, 0)

    // Use estimate tax calculations if available, otherwise recalculate
    let orderSubtotal = estimate.subtotal || estimate.subtotal_before_tax || subtotal
    let orderTotalTax = estimate.total_tax_amount || estimate.tax || 0
    let orderTotalAmount = estimate.total_amount || subtotal

    // If estimate doesn't have tax breakdown, recalculate
    if (!estimate.total_amount || !estimate.total_tax_amount) {
      const reverseCalc = calculateBaseFromTotalIncludingTaxes(subtotal, true)
      orderSubtotal = reverseCalc.baseAmount
      orderTotalTax = reverseCalc.taxBreakdown.totalTax
      orderTotalAmount = subtotal // Tax-inclusive
    }

    // Validate that estimate has a customer_id before creating order
    if (!estimate.customer_id && !estimate.client_id) {
      return NextResponse.json(
        { error: "Cannot create order from estimate: estimate must have a customer/client assigned" },
        { status: 400 }
      )
    }

    // Use client_id if customer_id is not available (older estimates might use client_id)
    const finalCustomerId = estimate.customer_id || estimate.client_id

    // Create order from estimate data
    // Orders from estimates start as "draft" (commercial) with "pending" execution
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        business_id: estimate.business_id,
        customer_id: finalCustomerId,
        estimate_id: estimateId,
        status: "draft", // Commercial state: draft (editable)
        execution_status: "pending", // Execution state: pending (not started)
        subtotal: orderSubtotal,
        total_tax: orderTotalTax,
        total_amount: orderTotalAmount,
        notes: estimate.notes || null,
      })
      .select()
      .single()

    if (orderError) {
      console.error("Error creating order from estimate:", orderError)
      return NextResponse.json(
        { error: orderError.message },
        { status: 500 }
      )
    }

    // Create order items from estimate items
    const orderItems = estimateItems.map((item: any) => ({
      order_id: order.id,
      product_service_id: item.product_service_id || null,
      description: item.description || "",
      quantity: Number(item.qty || item.quantity || 0),
      unit_price: Number(item.unit_price || item.price || 0),
      line_total: (Number(item.qty || item.quantity || 0)) * (Number(item.unit_price || item.price || 0)),
    }))

    const { error: itemsInsertError } = await supabase
      .from("order_items")
      .insert(orderItems)

    if (itemsInsertError) {
      console.error("Error creating order items:", itemsInsertError)
      // Delete the order if items fail
      await supabase.from("orders").delete().eq("id", order.id)
      return NextResponse.json(
        { error: itemsInsertError.message },
        { status: 500 }
      )
    }

    // Update estimate status to 'accepted' and mark as converted to order
    // This prevents any further conversions from this estimate
    await supabase
      .from("estimates")
      .update({ 
        status: "accepted",
        converted_to: "order"
      })
      .eq("id", estimateId)

    // Log audit entry
    const { createAuditLog } = await import("@/lib/auditLog")
    await createAuditLog({
      businessId: estimate.business_id,
      userId: user?.id || null,
      actionType: "order.created",
      entityType: "order",
      entityId: order.id,
      oldValues: null,
      newValues: order,
      request,
      description: `Order created from estimate ${estimate.estimate_number || estimateId}`,
    })

    // Fetch created order with all relations
    const { data: createdOrder } = await supabase
      .from("orders")
      .select(
        `
        *,
        customers (
          id,
          name,
          email,
          phone,
          address
        ),
        estimates (
          id,
          estimate_number
        )
      `
      )
      .eq("id", order.id)
      .single()

    const { data: createdItems } = await supabase
      .from("order_items")
      .select(
        `
        *,
        products_services (
          id,
          name
        )
      `
      )
      .eq("order_id", order.id)

    return NextResponse.json({
      success: true,
      orderId: order.id,
      order: createdOrder || order,
      items: createdItems || [],
      message: "Order created from estimate successfully",
    })
  } catch (error: any) {
    console.error("Error converting estimate to order:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

