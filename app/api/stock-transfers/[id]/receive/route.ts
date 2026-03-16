import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

/**
 * POST /api/stock-transfers/[id]/receive
 * Receive transfer and post to ledger
 * Updates inventory quantities and posts balance-sheet journal entry
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: transferId } = await params
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

    // Get transfer with items
    const { data: transfer, error: transferError } = await supabase
      .from("stock_transfers")
      .select(`
        *,
        items:stock_transfer_items(*)
      `)
      .eq("id", transferId)
      .eq("business_id", business.id)
      .single()

    if (transferError || !transfer) {
      return NextResponse.json(
        { error: "Transfer not found" },
        { status: 404 }
      )
    }

    // Validate status
    if (transfer.status !== "in_transit") {
      return NextResponse.json(
        { error: `Cannot receive transfer with status: ${transfer.status}. Only in_transit transfers can be received.` },
        { status: 400 }
      )
    }

    if (!transfer.items || transfer.items.length === 0) {
      return NextResponse.json(
        { error: "Transfer has no items" },
        { status: 400 }
      )
    }

    // Re-validate stock availability (in case it changed since transfer was sent)
    for (const item of transfer.items) {
      const stockQuery = supabase
        .from("products_stock")
        .select("stock_quantity, stock")
        .eq("product_id", item.product_id)
        .eq("store_id", transfer.from_store_id)

      if (item.variant_id) {
        stockQuery.eq("variant_id", item.variant_id)
      } else {
        stockQuery.is("variant_id", null)
      }

      const { data: stockData, error: stockError } = await stockQuery.maybeSingle()

      if (stockError) {
        return NextResponse.json(
          { error: `Failed to check stock for product ${item.product_id}` },
          { status: 500 }
        )
      }

      const availableStock = stockData
        ? Number(stockData.stock_quantity || stockData.stock || 0)
        : 0

      if (availableStock < item.quantity) {
        return NextResponse.json(
          {
            error: `Insufficient stock for product ${item.product_id}${item.variant_id ? ` (variant ${item.variant_id})` : ""}. Available: ${availableStock}, Required: ${item.quantity}`,
          },
          { status: 400 }
        )
      }
    }

    // Update inventory quantities
    for (const item of transfer.items) {
      // Decrease stock at from_store
      const fromStockQuery = supabase
        .from("products_stock")
        .select("id, stock_quantity, stock")
        .eq("product_id", item.product_id)
        .eq("store_id", transfer.from_store_id)

      if (item.variant_id) {
        fromStockQuery.eq("variant_id", item.variant_id)
      } else {
        fromStockQuery.is("variant_id", null)
      }

      const { data: fromStock, error: fromStockError } = await fromStockQuery.maybeSingle()

      if (fromStockError) {
        return NextResponse.json(
          { error: `Failed to load stock at from_store for product ${item.product_id}` },
          { status: 500 }
        )
      }

      if (fromStock) {
        const newFromStock = Math.max(0, Number(fromStock.stock_quantity || fromStock.stock || 0) - Number(item.quantity))
        await supabase
          .from("products_stock")
          .update({
            stock_quantity: newFromStock,
            stock: newFromStock,
          })
          .eq("id", fromStock.id)
      }

      // Increase stock at to_store
      const toStockQuery = supabase
        .from("products_stock")
        .select("id, stock_quantity, stock")
        .eq("product_id", item.product_id)
        .eq("store_id", transfer.to_store_id)

      if (item.variant_id) {
        toStockQuery.eq("variant_id", item.variant_id)
      } else {
        toStockQuery.is("variant_id", null)
      }

      const { data: toStock, error: toStockError } = await toStockQuery.maybeSingle()

      if (toStockError) {
        return NextResponse.json(
          { error: `Failed to load stock at to_store for product ${item.product_id}` },
          { status: 500 }
        )
      }

      if (toStock) {
        const newToStock = Number(toStock.stock_quantity || toStock.stock || 0) + Number(item.quantity)
        await supabase
          .from("products_stock")
          .update({
            stock_quantity: newToStock,
            stock: newToStock,
          })
          .eq("id", toStock.id)
      } else {
        // Create stock record if it doesn't exist
        await supabase
          .from("products_stock")
          .insert({
            product_id: item.product_id,
            variant_id: item.variant_id || null,
            store_id: transfer.to_store_id,
            stock_quantity: Number(item.quantity),
            stock: Number(item.quantity),
          })
      }
    }

    // Post to ledger using RPC function
    const { data: journalId, error: ledgerError } = await supabase.rpc(
      "post_stock_transfer_to_ledger",
      { p_stock_transfer_id: transferId }
    )

    if (ledgerError) {
      console.error("Error posting to ledger:", ledgerError)
      // NOTE: Inventory quantities are already updated, but ledger posting failed
      // This is a partial failure - consider rolling back inventory or alerting admin
      return NextResponse.json(
        {
          error: `Failed to post transfer to ledger: ${ledgerError.message}. Inventory quantities have been updated.`,
          warning: "Inventory updated but ledger posting failed. Manual intervention may be required.",
        },
        { status: 500 }
      )
    }

    // Update transfer status to received
    const { data: updatedTransfer, error: updateError } = await supabase
      .from("stock_transfers")
      .update({
        status: "received",
        received_by: user.id,
        received_at: new Date().toISOString(),
      })
      .eq("id", transferId)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating transfer status:", updateError)
      // Ledger posted but status update failed - this is less critical
      return NextResponse.json(
        {
          success: true,
          warning: "Transfer received and posted to ledger, but status update failed.",
          journal_id: journalId,
        },
        { status: 200 }
      )
    }

    return NextResponse.json({
      success: true,
      transfer: updatedTransfer,
      journal_id: journalId,
    })
  } catch (error: any) {
    console.error("Error in POST /api/stock-transfers/[id]/receive:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
