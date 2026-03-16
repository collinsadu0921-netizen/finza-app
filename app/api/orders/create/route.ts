import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
import { createAuditLog } from "@/lib/auditLog"

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
      return NextResponse.json(
        { error: "Business not found. Please ensure you have a business set up." },
        { status: 404 }
      )
    }

    const body = await request.json()
    const {
      estimateId,
      customerId,
      items,
      notes,
      apply_taxes = true,
    } = body

    const finalBusinessId = business.id

    // Validate required fields
    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields: items are required" },
        { status: 400 }
      )
    }
    
    if (!estimateId && !customerId) {
      return NextResponse.json(
        { error: "Missing required fields: customerId is required when not creating from estimate" },
        { status: 400 }
      )
    }

    let orderData: any = {
      business_id: finalBusinessId,
      customer_id: customerId,
      status: "draft", // Commercial state: draft (editable)
      execution_status: "pending", // Execution state: pending (not started)
      notes: notes || null,
    }

    // If estimateId is provided, load estimate and copy data
    let finalItems = items
    if (estimateId) {
      const { data: estimate, error: estimateError } = await supabase
        .from("estimates")
        .select("*")
        .eq("id", estimateId)
        .eq("business_id", finalBusinessId)
        .single()

      if (estimateError || !estimate) {
        return NextResponse.json(
          { error: "Estimate not found" },
          { status: 404 }
        )
      }

      // Copy estimate data
      orderData.estimate_id = estimateId
      // Use estimate customer if available, otherwise use provided customerId
      const estimateCustomerId = estimate.customer_id || estimate.client_id
      if (estimateCustomerId) {
        orderData.customer_id = estimateCustomerId
      } else if (customerId) {
        orderData.customer_id = customerId
      } else {
        return NextResponse.json(
          { error: "Cannot create order: estimate has no customer and no customerId provided" },
          { status: 400 }
        )
      }
      
      // Load estimate items if items not provided in request
      if (!items || items.length === 0) {
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
        finalItems = estimateItems.map((item: any) => ({
          product_service_id: item.product_service_id || null,
          description: item.description || "",
          quantity: Number(item.qty || item.quantity || 0),
          unit_price: Number(item.unit_price || item.price || 0),
        }))

        // Use estimate tax calculations if available
        if (estimate.total_amount) {
          orderData.subtotal = estimate.subtotal || estimate.subtotal_before_tax || 0
          orderData.total_tax = estimate.total_tax_amount || estimate.tax || 0
          orderData.total_amount = estimate.total_amount
        }
      }
    }

    // If items are provided (either from request or from estimate), calculate from items
    if (finalItems && finalItems.length > 0) {
      // Calculate subtotal from line items (treat prices as tax-inclusive, like invoices)
      const subtotal = items.reduce((sum: number, item: any) => {
        const qty = Number(item.quantity || item.qty || 0)
        const unitPrice = Number(item.unit_price || item.price || 0)
        return sum + qty * unitPrice
      }, 0)

      // Calculate Ghana taxes - treat entered prices as tax-inclusive
      let taxResult
      let baseSubtotal = subtotal

      if (apply_taxes && subtotal > 0) {
        // Reverse calculate base amount from tax-inclusive total
        const reverseCalc = calculateBaseFromTotalIncludingTaxes(subtotal, true)
        baseSubtotal = reverseCalc.baseAmount
        taxResult = reverseCalc.taxBreakdown
      } else {
        // No taxes applied
        taxResult = {
          nhil: 0,
          getfund: 0,
          covid: 0,
          vat: 0,
          totalTax: 0,
          grandTotal: subtotal,
        }
      }

      // Only override if we haven't set from estimate
      if (!orderData.subtotal && !orderData.total_tax && !orderData.total_amount) {
        orderData.subtotal = baseSubtotal
        orderData.total_tax = taxResult.totalTax
        orderData.total_amount = subtotal // Total is the tax-inclusive amount
      }
    }

    // Create order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert(orderData)
      .select()
      .single()

    if (orderError) {
      console.error("Error creating order:", orderError)
      return NextResponse.json(
        {
          success: false,
          error: "Order could not be saved. Please check all fields and try again.",
          message: orderError.message,
        },
        { status: 500 }
      )
    }

    // Create order items (use finalItems which may have come from estimate)
    const orderItemsData = (finalItems || []).map((item: any) => ({
      order_id: order.id,
      product_service_id: item.product_service_id || null,
      description: item.description || "",
      quantity: Number(item.quantity || item.qty || 0),
      unit_price: Number(item.unit_price || item.price || 0),
      line_total: (Number(item.quantity || item.qty || 0)) * (Number(item.unit_price || item.price || 0)),
    }))

    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(orderItemsData)

    if (itemsError) {
      console.error("Error creating order items:", itemsError)
      // Delete the order if items fail
      await supabase.from("orders").delete().eq("id", order.id)
      return NextResponse.json(
        {
          success: false,
          error: "Order items could not be saved. Please check all item fields and try again.",
          message: itemsError.message,
        },
        { status: 500 }
      )
    }

    // Update estimate status to 'accepted' if order was created from estimate
    if (estimateId) {
      await supabase
        .from("estimates")
        .update({ status: "accepted" })
        .eq("id", estimateId)
    }

    // Log audit entry
    await createAuditLog({
      businessId: finalBusinessId,
      userId: user?.id || null,
      actionType: "order.created",
      entityType: "order",
      entityId: order.id,
      oldValues: null,
      newValues: order,
      request,
    })

    // Fetch created order with items
    const { data: createdOrder, error: fetchError } = await supabase
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

    const { data: orderItems } = await supabase
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

    // Return success response
    return NextResponse.json(
      {
        success: true,
        orderId: order.id,
        order: createdOrder || order,
        items: orderItems || [],
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("Error in order creation:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Order could not be created. Please check all fields and try again.",
        message: error.message || "Internal server error",
      },
      { status: 500 }
    )
  }
}

