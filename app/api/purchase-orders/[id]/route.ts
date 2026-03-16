import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * GET /api/purchase-orders/[id]
 * Get purchase order details with items
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    const { data: purchaseOrder, error } = await supabase
      .from("purchase_orders")
      .select(`
        *,
        supplier:suppliers(id, name, phone, email),
        created_by_user:users!purchase_orders_created_by_fkey(id, full_name, email),
        received_by_user:users!purchase_orders_received_by_fkey(id, full_name, email),
        items:purchase_order_items(
          *,
          product:products(id, name, price)
        )
      `)
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (error || !purchaseOrder) {
      return NextResponse.json(
        { error: "Purchase order not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ purchase_order: purchaseOrder })
  } catch (error: any) {
    console.error("Error in GET /api/purchase-orders/[id]:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
