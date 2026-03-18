import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const { data: proforma, error } = await supabase
      .from("proforma_invoices")
      .select(`
        id, business_id, proforma_number, issue_date, validity_date,
        payment_terms, notes, footer_message,
        subtotal, total_tax, total, nhil, getfund, covid, vat,
        status, apply_taxes, tax_lines, currency_code, currency_symbol,
        client_name_signed, client_id_type, client_id_number,
        client_signature, signed_at, rejected_reason, rejected_at,
        customers ( id, name, email, phone, address )
      `)
      .eq("public_token", token)
      .is("deleted_at", null)
      .single()

    if (error || !proforma) {
      return NextResponse.json({ error: "Proforma not found" }, { status: 404 })
    }

    const [{ data: items }, { data: biz }] = await Promise.all([
      supabase
        .from("proforma_invoice_items")
        .select("id, description, qty, unit_price, discount_amount, line_subtotal")
        .eq("proforma_invoice_id", proforma.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("businesses")
        .select("legal_name, trading_name, address_street, address_city, address_region, phone, email, website, tin, logo_url")
        .eq("id", proforma.business_id)
        .single(),
    ])

    return NextResponse.json({
      proforma,
      items: items ?? [],
      business: biz ?? null,
    })
  } catch (err: any) {
    console.error("public/proforma GET error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
