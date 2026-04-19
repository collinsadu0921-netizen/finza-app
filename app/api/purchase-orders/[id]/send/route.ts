import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * POST /api/purchase-orders/[id]/send
 * Mark purchase order as sent
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

    // Get PO
    const { data: po, error: poError } = await supabase
      .from("purchase_orders")
      .select("*")
      .eq("id", poId)
      .eq("business_id", business.id)
      .single()

    if (poError || !po) {
      return NextResponse.json(
        { error: "Purchase order not found" },
        { status: 404 }
      )
    }

    // Buy list: planned → ordered (sent to supplier)
    if (po.status !== "planned") {
      return NextResponse.json(
        {
          error: `Only a planned buy list can be marked ordered (current: ${po.status}).`,
        },
        { status: 400 }
      )
    }

    const { data: updatedPO, error: updateError } = await supabase
      .from("purchase_orders")
      .update({ status: "ordered" })
      .eq("id", poId)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating purchase order:", updateError)
      return NextResponse.json(
        { error: "Failed to send purchase order" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      purchase_order: updatedPO,
    })
  } catch (error: any) {
    console.error("Error in POST /api/purchase-orders/[id]/send:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
