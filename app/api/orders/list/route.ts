import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(request: NextRequest) {
  try {
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

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const customerId = searchParams.get("customer_id")
    const estimateId = searchParams.get("estimate_id")
    const invoiceId = searchParams.get("invoice_id")
    const search = searchParams.get("search")

    let query = supabase
      .from("orders")
      .select(
        `
        *,
        customers (
          id,
          name,
          email,
          phone
        ),
        estimates (
          id,
          estimate_number
        ),
        invoices (
          id,
          invoice_number
        )
      `
      )
      // AUTH DISABLED FOR DEVELOPMENT - Removed business_id filter
      // .eq("business_id", business.id)
      .order("created_at", { ascending: false })

    if (status && status !== "all") {
      query = query.eq("status", status)
    }

    if (customerId) {
      query = query.eq("customer_id", customerId)
    }

    if (estimateId) {
      query = query.eq("estimate_id", estimateId)
    }

    if (invoiceId) {
      query = query.eq("invoice_id", invoiceId)
    }

    if (search) {
      // Search by customer name or order ID
      query = query.or(`notes.ilike.%${search}%,customers.name.ilike.%${search}%`)
    }

    const { data: orders, error } = await query

    if (error) {
      console.error("Error fetching orders:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ orders: orders || [] })
  } catch (error: any) {
    console.error("Error in order list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

