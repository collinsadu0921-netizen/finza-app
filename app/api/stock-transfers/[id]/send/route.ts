import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

/**
 * POST /api/stock-transfers/[id]/send
 * Mark transfer as in_transit (sends the transfer)
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

    // Get transfer
    const { data: transfer, error: transferError } = await supabase
      .from("stock_transfers")
      .select("*")
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
    if (transfer.status !== "draft") {
      return NextResponse.json(
        { error: `Cannot send transfer with status: ${transfer.status}. Only draft transfers can be sent.` },
        { status: 400 }
      )
    }

    // Update status to in_transit
    const { data: updatedTransfer, error: updateError } = await supabase
      .from("stock_transfers")
      .update({ status: "in_transit" })
      .eq("id", transferId)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating transfer:", updateError)
      return NextResponse.json(
        { error: "Failed to send transfer" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      transfer: updatedTransfer,
    })
  } catch (error: any) {
    console.error("Error in POST /api/stock-transfers/[id]/send:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
