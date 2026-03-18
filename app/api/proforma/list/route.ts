import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const customerId = searchParams.get("customer_id")
    const search = searchParams.get("search")

    let query = supabase
      .from("proforma_invoices")
      .select(
        `
        *,
        customers (
          id,
          name,
          email,
          phone
        )
      `
      )
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (status) {
      query = query.eq("status", status)
    }

    if (customerId) {
      query = query.eq("customer_id", customerId)
    }

    if (search) {
      // Search for customers matching the search term first
      const { data: matchingCustomers } = await supabase
        .from("customers")
        .select("id")
        .ilike("name", `%${search}%`)
        .is("deleted_at", null)

      const matchingCustomerIds = matchingCustomers?.map((c: any) => c.id) || []

      const searchConditions = [`proforma_number.ilike.%${search}%`]

      if (matchingCustomerIds.length > 0) {
        searchConditions.push(`customer_id.in.(${matchingCustomerIds.join(",")})`)
      }

      query = query.or(searchConditions.join(","))
    }

    const { data: proformas, error } = await query

    if (error) {
      console.error("Error fetching proforma invoices:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ proformas: proformas || [] })
  } catch (error: any) {
    console.error("Error in proforma invoice list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
