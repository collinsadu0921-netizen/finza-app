import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * POST /api/purchase-orders/[id]/receive
 * Receive purchase order and post to ledger
 * Updates inventory quantities and posts Inventory DR, AP CR journal entry
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: poId } = await params
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

    // poId already extracted from params above

    // Get PO with items
    const { data: po, error: poError } = await supabase
      .from("purchase_orders")
      .select(`
        *,
        items:purchase_order_items(*)
      `)
      .eq("id", poId)
      .eq("business_id", business.id)
      .single()

    if (poError || !po) {
      return NextResponse.json(
        { error: "Purchase order not found" },
        { status: 404 }
      )
    }

    // Validate status
    if (po.status !== "sent" && po.status !== "draft") {
      return NextResponse.json(
        { error: `Cannot receive purchase order with status: ${po.status}. Only draft or sent orders can be received.` },
        { status: 400 }
      )
    }

    if (!po.items || po.items.length === 0) {
      return NextResponse.json(
        { error: "Purchase order has no items" },
        { status: 400 }
      )
    }

    // Get store_id from request body (optional, defaults to first store or user's store)
    const body = await request.json().catch(() => ({}))
    const storeId = body.store_id || null

    // If store_id provided, verify it exists
    if (storeId) {
      const { data: store, error: storeError } = await supabase
        .from("stores")
        .select("id")
        .eq("id", storeId)
        .eq("business_id", business.id)
        .single()

      if (storeError || !store) {
        return NextResponse.json(
          { error: "Invalid store ID or store does not belong to business" },
          { status: 400 }
        )
      }
    } else {
      // Try to get user's default store
      const { data: userData } = await supabase
        .from("users")
        .select("store_id")
        .eq("id", user.id)
        .maybeSingle()

      if (userData?.store_id) {
        // Use user's store if available
        // Note: This is a fallback - ideally store_id should be provided
      }
    }

    // Update inventory quantities
    for (const item of po.items) {
      // Increase stock at store (or create stock record)
      const stockQuery = supabase
        .from("products_stock")
        .select("id, stock_quantity, stock")
        .eq("product_id", item.product_id)

      if (item.variant_id) {
        stockQuery.eq("variant_id", item.variant_id)
      } else {
        stockQuery.is("variant_id", null)
      }

      if (storeId) {
        stockQuery.eq("store_id", storeId)
      }

      const { data: stockData, error: stockError } = await stockQuery.maybeSingle()

      if (stockError) {
        return NextResponse.json(
          { error: `Failed to load stock for product ${item.product_id}` },
          { status: 500 }
        )
      }

      if (stockData) {
        const newStock = Number(stockData.stock_quantity || stockData.stock || 0) + Number(item.quantity)
        await supabase
          .from("products_stock")
          .update({
            stock_quantity: newStock,
            stock: newStock,
          })
          .eq("id", stockData.id)
      } else {
        // Create stock record if it doesn't exist
        if (!storeId) {
          return NextResponse.json(
            { error: "store_id is required to receive purchase order. Stock must be assigned to a store." },
            { status: 400 }
          )
        }

        await supabase
          .from("products_stock")
          .insert({
            product_id: item.product_id,
            variant_id: item.variant_id || null,
            store_id: storeId,
            stock_quantity: Number(item.quantity),
            stock: Number(item.quantity),
          })
      }
    }

    // Post to ledger using RPC function
    const { data: journalId, error: ledgerError } = await supabase.rpc(
      "post_purchase_order_receipt_to_ledger",
      { p_purchase_order_id: poId }
    )

    if (ledgerError) {
      console.error("Error posting to ledger:", ledgerError)
      // NOTE: Inventory quantities are already updated, but ledger posting failed
      // This is a partial failure - consider rolling back inventory or alerting admin
      return NextResponse.json(
        {
          error: `Failed to post purchase order to ledger: ${ledgerError.message}. Inventory quantities have been updated.`,
          warning: "Inventory updated but ledger posting failed. Manual intervention may be required.",
        },
        { status: 500 }
      )
    }

    // Update PO status to received
    const { data: updatedPO, error: updateError } = await supabase
      .from("purchase_orders")
      .update({
        status: "received",
        received_by: user.id,
        received_at: new Date().toISOString(),
      })
      .eq("id", poId)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating PO status:", updateError)
      // Ledger posted but status update failed - this is less critical
      return NextResponse.json(
        {
          success: true,
          warning: "Purchase order received and posted to ledger, but status update failed.",
          journal_id: journalId,
        },
        { status: 200 }
      )
    }

    return NextResponse.json({
      success: true,
      purchase_order: updatedPO,
      journal_id: journalId,
    })
  } catch (error: any) {
    console.error("Error in POST /api/purchase-orders/[id]/receive:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
