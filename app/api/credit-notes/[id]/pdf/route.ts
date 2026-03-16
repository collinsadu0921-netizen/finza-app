import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const creditNoteId = resolvedParams.id

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

    // Fetch credit note with all details
    const { data: creditNote, error: creditNoteError } = await supabase
      .from("credit_notes")
      .select(
        `
        id, business_id, invoice_id, credit_number, date, reason, subtotal, nhil, getfund, covid, vat, total_tax, total, status, notes, public_token, created_at, updated_at, deleted_at, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction,
        invoices (
          id,
          invoice_number,
          customers (
            id,
            name,
            email,
            phone,
            address
          )
        )
      `
      )
      .eq("id", creditNoteId)
      // AUTH DISABLED FOR DEVELOPMENT - Removed business_id filter
      // .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (creditNoteError || !creditNote) {
      return NextResponse.json(
        { error: "Credit note not found" },
        { status: 404 }
      )
    }

    const { data: items, error: itemsError } = await supabase
      .from("credit_note_items")
      .select("*")
      .eq("credit_note_id", creditNoteId)
      .order("created_at", { ascending: true })

    if (itemsError) {
      console.error("Error fetching credit note items:", itemsError)
    }

    // Get business info
    let businessInfo = null
    if (creditNote.business_id) {
      const { data: business } = await supabase
        .from("businesses")
        .select("name, email, phone, address, tin, tax_id")
        .eq("id", creditNote.business_id)
        .single()
      businessInfo = business
    }

    // Redirect to PDF preview endpoint that uses the shared document component
    return NextResponse.redirect(
      new URL(`/api/credit-notes/${creditNoteId}/pdf-preview`, request.url)
    )
  } catch (error: any) {
    console.error("Error generating credit note PDF:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


