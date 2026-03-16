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

    let query = supabase
      .from("recurring_invoices")
      .select(
        `
        *,
        customers (
          id,
          name,
          email,
          phone,
          whatsapp_phone
        )
      `
      )
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("next_run_date", { ascending: true })

    if (status) {
      query = query.eq("status", status)
    }

    const { data: recurringInvoices, error } = await query

    if (error) {
      console.error("Error fetching recurring invoices:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ recurringInvoices: recurringInvoices || [] })
  } catch (error: any) {
    console.error("Error in recurring invoices list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
