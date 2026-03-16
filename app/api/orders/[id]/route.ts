import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const orderId = resolvedParams.id

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT - Keep login check only
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT - Bypass business ownership check
    // const business = await getCurrentBusiness(supabase, user.id)
    // if (!business) {
    //   return NextResponse.json({ error: "Business not found" }, { status: 404 })
    // }

    // Fetch order with all related data
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        `
        *,
        customers (
          id,
          name,
          email,
          phone,
          whatsapp_phone,
          address,
          tin
        ),
        estimates (
          id,
          estimate_number,
          status
        ),
        invoices (
          id,
          invoice_number,
          status
        )
      `
      )
      .eq("id", orderId)
      .single()

    if (orderError || !order) {
      console.error("Error fetching order:", orderError)
      return NextResponse.json(
        { error: "Order not found", details: orderError?.message },
        { status: 404 }
      )
    }

    // Fetch order items
    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select(
        `
        *,
        products_services (
          id,
          name,
          type
        )
      `
      )
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })

    if (itemsError) {
      console.error("Error fetching order items:", itemsError)
    }

    return NextResponse.json({
      order,
      items: items || [],
    })
  } catch (error: any) {
    console.error("Error fetching order:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const orderId = resolvedParams.id

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required" },
        { status: 400 }
      )
    }

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
    const {
      status: newCommercialStatus,
      execution_status: newExecutionStatus,
      customer_id,
      notes,
      items,
      apply_taxes = true,
    } = body

    const { data: existingOrder, error: checkError } = await supabase
      .from("orders")
      .select("id, business_id, status, execution_status, invoice_id, revision_number")
      .eq("id", orderId)
      .eq("business_id", business.id)
      .single()

    if (checkError || !existingOrder) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      )
    }

    // Import document state utilities
    const { canEditOrder, isValidExecutionTransition } = await import("@/lib/documentState")

    // Determine update type
    const isExecutionStatusUpdate = newExecutionStatus !== undefined && 
      newCommercialStatus === undefined &&
      items === undefined && 
      customer_id === undefined && 
      notes === undefined

    const isCommercialEdit = items !== undefined || 
      customer_id !== undefined || 
      notes !== undefined ||
      newCommercialStatus !== undefined

    // Prevent updates to converted/cancelled orders (read-only)
    if (existingOrder.status === "converted" || existingOrder.status === "cancelled" || existingOrder.invoice_id) {
      return NextResponse.json(
        { error: "Cannot update an order that has been converted, cancelled, or invoiced" },
        { status: 400 }
      )
    }

    // Handle execution status updates (fulfillment progress)
    if (isExecutionStatusUpdate) {
      // Execution status updates only work for issued orders
      if (existingOrder.status !== "issued") {
        return NextResponse.json(
          { error: `Cannot update execution status for order with commercial status "${existingOrder.status}". Only issued orders can have execution status updates.` },
          { status: 400 }
        )
      }

      // Validate execution status transition
      const currentExecutionStatus = (existingOrder.execution_status || "pending") as any
      if (!isValidExecutionTransition(currentExecutionStatus, newExecutionStatus as any)) {
        return NextResponse.json(
          { error: `Invalid execution status transition from "${currentExecutionStatus}" to "${newExecutionStatus}". Allowed: ${currentExecutionStatus === "pending" ? "pending → active" : currentExecutionStatus === "active" ? "active → completed" : "no transitions"}` },
          { status: 400 }
        )
      }

      // Update execution status only
      const { data: updatedOrder, error: updateError } = await supabase
        .from("orders")
        .update({
          execution_status: newExecutionStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        )
      }

      // Log audit entry
      const { createAuditLog } = await import("@/lib/auditLog")
      await createAuditLog({
        businessId: existingOrder.business_id,
        userId: user?.id || null,
        actionType: "order.execution_status_updated",
        entityType: "order",
        entityId: updatedOrder.id,
        oldValues: { execution_status: existingOrder.execution_status },
        newValues: { execution_status: updatedOrder.execution_status },
        request,
      })

      // Fetch updated order with relations
      const { data: fullOrder } = await supabase
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
          )
        `
        )
        .eq("id", orderId)
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
        .eq("order_id", orderId)

      return NextResponse.json({
        success: true,
        orderId: updatedOrder.id,
        order: fullOrder || updatedOrder,
        items: orderItems || [],
      })
    }

    // Handle commercial edits (items, customer, notes, commercial status)
    if (isCommercialEdit) {
      const editResult = canEditOrder({
        status: existingOrder.status as any,
        execution_status: existingOrder.execution_status,
      })

      if (editResult === false) {
        return NextResponse.json(
          { error: `Cannot edit order with commercial status "${existingOrder.status}" and execution status "${existingOrder.execution_status}". Only draft orders can be directly edited, and issued orders (not completed) can be revised.` },
          { status: 400 }
        )
      }

      const shouldCreateNewRevision = editResult === "revision"
      const businessId = existingOrder.business_id

      // Prepare update data
      const updateData: any = {
        updated_at: new Date().toISOString(),
      }

      // Update commercial status if provided
      if (newCommercialStatus) {
        const validCommercialStatuses = ["draft", "issued", "converted", "cancelled"]
        if (!validCommercialStatuses.includes(newCommercialStatus)) {
          return NextResponse.json(
            { error: `Invalid commercial status. Must be one of: ${validCommercialStatuses.join(", ")}` },
            { status: 400 }
          )
        }
        updateData.status = newCommercialStatus
        
        // Set issued_at timestamp when status changes to "issued"
        if (newCommercialStatus === "issued" && existingOrder.status !== "issued") {
          updateData.issued_at = new Date().toISOString()
        }
      }

      // Update customer if provided
      if (customer_id !== undefined) {
        updateData.customer_id = customer_id || null
      }

      // Update notes if provided
      if (notes !== undefined) {
        updateData.notes = notes
      }

      // If items are provided, recalculate totals
      if (items && items.length > 0) {
        // Calculate subtotal from line items (treat prices as tax-inclusive)
        const subtotal = items.reduce((sum: number, item: any) => {
          const qty = Number(item.quantity || item.qty || 0)
          const unitPrice = Number(item.unit_price || item.price || 0)
          return sum + qty * unitPrice
        }, 0)

        // Calculate Ghana taxes
        const { calculateBaseFromTotalIncludingTaxes } = await import("@/lib/ghanaTaxEngine")
        let taxResult
        let baseSubtotal = subtotal

        if (apply_taxes && subtotal > 0) {
          const reverseCalc = calculateBaseFromTotalIncludingTaxes(subtotal, true)
          baseSubtotal = reverseCalc.baseAmount
          taxResult = reverseCalc.taxBreakdown
        } else {
          taxResult = {
            nhil: 0,
            getfund: 0,
            covid: 0,
            vat: 0,
            totalTax: 0,
            grandTotal: subtotal,
          }
        }

        updateData.subtotal = baseSubtotal
        updateData.total_tax = taxResult.totalTax
        updateData.total_amount = subtotal // Tax-inclusive total
      }

      let finalOrderId = orderId
      let finalOrder: any

      if (shouldCreateNewRevision) {
        // Editing an issued order: Create new draft revision
        // Fetch original order to copy all fields
        const { data: originalOrder, error: origError } = await supabase
          .from("orders")
          .select("*")
          .eq("id", orderId)
          .single()

        if (origError || !originalOrder) {
          return NextResponse.json(
            { error: "Original order not found" },
            { status: 404 }
          )
        }

        // Get next revision number
        const nextRevisionNumber = (originalOrder.revision_number || 1) + 1

        // Create new revision (draft)
        const { data: newRevision, error: revisionError } = await supabase
          .from("orders")
          .insert({
            ...updateData,
            business_id: businessId,
            customer_id: customer_id !== undefined ? (customer_id || null) : originalOrder.customer_id,
            notes: notes !== undefined ? notes : originalOrder.notes,
            status: "draft", // New revision starts as draft
            execution_status: "pending", // Reset execution state
            revision_number: nextRevisionNumber,
            supersedes_id: orderId, // Link to original
            invoice_id: null, // Reset invoice link
          })
          .select()
          .single()

        if (revisionError || !newRevision) {
          return NextResponse.json(
            { error: revisionError?.message || "Failed to create revision" },
            { status: 500 }
          )
        }

        finalOrderId = newRevision.id
        finalOrder = newRevision

        // Copy order items to new revision if items weren't provided
        if (!items || items.length === 0) {
          const { data: originalItems } = await supabase
            .from("order_items")
            .select("*")
            .eq("order_id", orderId)

          if (originalItems && originalItems.length > 0) {
            const newItems = originalItems.map((item: any) => ({
              order_id: finalOrderId,
              product_service_id: item.product_service_id,
              description: item.description,
              quantity: item.quantity || item.qty || 0,
              unit_price: item.unit_price || item.price || 0,
              line_total: item.line_total || item.total || 0,
            }))

            await supabase.from("order_items").insert(newItems)
          }
        }
      } else {
        // Editing a draft: Update in place
        const { data: updatedOrder, error: updateError } = await supabase
          .from("orders")
          .update(updateData)
          .eq("id", orderId)
          .select()
          .single()

        if (updateError) {
          return NextResponse.json(
            { error: updateError.message },
            { status: 500 }
          )
        }

        finalOrder = updatedOrder
      }

      // Update items if provided (or if creating revision with new items)
      if (items && items.length > 0) {
        // Delete existing items
        await supabase.from("order_items").delete().eq("order_id", finalOrderId)

        // Insert new items
        const orderItemsData = items.map((item: any) => {
          const qty = Number(item.quantity ?? item.qty ?? 0)
          const unitPrice = Number(item.unit_price ?? item.price ?? 0)
          const lineTotal = qty * unitPrice
          
          return {
            order_id: finalOrderId,
            product_service_id: item.product_service_id || null,
            description: item.description || "",
            quantity: qty,
            unit_price: unitPrice,
            line_total: lineTotal,
          }
        })

        const { error: itemsError } = await supabase
          .from("order_items")
          .insert(orderItemsData)

        if (itemsError) {
          console.error("Error updating order items:", itemsError)
        }
      }

      // Log audit entry
      const { createAuditLog } = await import("@/lib/auditLog")
      await createAuditLog({
        businessId: businessId,
        userId: user?.id || null,
        actionType: shouldCreateNewRevision ? "order.revision_created" : "order.updated",
        entityType: "order",
        entityId: finalOrder.id,
        oldValues: existingOrder,
        newValues: finalOrder,
        request,
      })

      // Fetch updated order with items
      const { data: updatedOrder } = await supabase
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
          )
        `
        )
        .eq("id", finalOrderId)
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
        .eq("order_id", finalOrderId)

      return NextResponse.json({
        success: true,
        orderId: finalOrder.id,
        order: updatedOrder || finalOrder,
        items: orderItems || [],
        isRevision: shouldCreateNewRevision,
      })
    }

    // If neither execution status update nor commercial edit, return error
    return NextResponse.json(
      { error: "No valid update provided. Specify execution_status for fulfillment updates, or items/customer/notes for commercial edits." },
      { status: 400 }
    )
  }
  catch (error: any) {
    console.error("Error updating order:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Order could not be updated. Please check all fields and try again.",
        message: error.message || "Internal server error",
      },
      { status: 500 }
    )
  }
}

