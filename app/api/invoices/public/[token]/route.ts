import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    // Get invoice by public token
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select(
        `
        *,
        customers (
          id,
          name,
          email,
          phone,
          address
        )
      `
      )
      .eq("public_token", token)
      .is("deleted_at", null)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404 }
      )
    }

    if (invoice.status === "cancelled") {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404 }
      )
    }

    // Get business profile
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", invoice.business_id)
      .single()

    if (businessError) {
      console.error("Error fetching business:", businessError)
    }

    // Get invoice settings
    const { data: settings, error: settingsError } = await supabase
      .from("invoice_settings")
      .select("*")
      .eq("business_id", invoice.business_id)
      .maybeSingle()

    if (settingsError) {
      console.error("Error fetching invoice settings:", settingsError)
    }

    // Get invoice items
    const { data: items, error: itemsError } = await supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", invoice.id)
      .order("created_at", { ascending: true })

    if (itemsError) {
      console.error("Error fetching invoice items:", itemsError)
    }

    return NextResponse.json({
      invoice,
      business: business || null,
      settings: settings || null,
      items: items || [],
    })
  } catch (error: any) {
    console.error("Error fetching public invoice:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

