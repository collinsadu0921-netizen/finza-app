import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const { token } = await params

    // Get credit note by public token
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
            whatsapp_phone
          )
        )
      `
      )
      .eq("public_token", token)
      .is("deleted_at", null)
      .single()

    if (creditNoteError || !creditNote) {
      return NextResponse.json(
        { error: "Credit note not found" },
        { status: 404 }
      )
    }

    // Get business profile
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", creditNote.business_id)
      .single()

    if (businessError) {
      console.error("Error fetching business:", businessError)
    }

    // Get credit note items
    const { data: items, error: itemsError } = await supabase
      .from("credit_note_items")
      .select("*")
      .eq("credit_note_id", creditNote.id)
      .order("created_at", { ascending: true })

    if (itemsError) {
      console.error("Error fetching credit note items:", itemsError)
    }

    return NextResponse.json({
      creditNote,
      business: business || null,
      items: items || [],
    })
  } catch (error: any) {
    console.error("Error fetching public credit note:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

