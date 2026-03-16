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
    const invoiceId = searchParams.get("invoice_id")
    const status = searchParams.get("status")
    const businessId = searchParams.get("business_id") // Allow filtering by business_id if provided

    let query = supabase
      .from("credit_notes")
      .select(
        `
        id, business_id, invoice_id, credit_number, date, reason, subtotal, nhil, getfund, covid, vat, total_tax, total, status, notes, public_token, created_at, updated_at, deleted_at, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction,
        invoices (
          id,
          invoice_number,
          customers (
            id,
            name
          )
        )
      `
      )
      // AUTH DISABLED FOR DEVELOPMENT - Removed business_id filter, add optional filter
      // .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    if (businessId) {
      query = query.eq("business_id", businessId)
    }

    if (invoiceId) {
      query = query.eq("invoice_id", invoiceId)
    }

    if (status) {
      query = query.eq("status", status)
    }

    const { data: creditNotes, error } = await query

    if (error) {
      console.error("Error fetching credit notes:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ creditNotes: creditNotes || [] })
  } catch (error: any) {
    console.error("Error in credit notes list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

