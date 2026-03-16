import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * GET /api/customers/[id]/history
 * Get customer sale history (read-only, for POS context)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params
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

    // Get limit from query params (default 10)
    const searchParams = request.nextUrl.searchParams
    const limit = parseInt(searchParams.get("limit") || "10", 10)

    // Verify customer belongs to business
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, name")
      .eq("id", customerId)
      .eq("business_id", business.id)
      .maybeSingle()

    if (customerError || !customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      )
    }

    // Get sale history using RPC function
    const { data: saleHistory, error: historyError } = await supabase.rpc(
      "get_customer_sale_history",
      {
        p_customer_id: customerId,
        p_business_id: business.id,
        p_limit: limit,
      }
    )

    if (historyError) {
      console.error("Error fetching customer sale history:", historyError)
      return NextResponse.json(
        { error: "Failed to fetch sale history" },
        { status: 500 }
      )
    }

    // Get sale statistics
    const { data: stats, error: statsError } = await supabase.rpc(
      "get_customer_sale_stats",
      {
        p_customer_id: customerId,
        p_business_id: business.id,
      }
    )

    if (statsError) {
      console.error("Error fetching customer sale stats:", statsError)
      // Continue without stats if function fails
    }

    return NextResponse.json({
      customer: {
        id: customer.id,
        name: customer.name,
      },
      saleHistory: saleHistory || [],
      stats: stats && stats.length > 0 ? stats[0] : {
        total_sales_count: 0,
        total_spend: 0,
        average_basket_size: 0,
        last_purchase_date: null,
      },
    })
  } catch (error: any) {
    console.error("Error in GET /api/customers/[id]/history:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
