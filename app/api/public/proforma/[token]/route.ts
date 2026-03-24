import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await params
    const token = decodeURIComponent(rawToken).trim()
    if (!token) {
      return NextResponse.json({ error: "Proforma not found" }, { status: 404 })
    }

    const supabase = serviceClient()

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

    const [{ data: items }, { data: biz }, { data: settings }] = await Promise.all([
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
      supabase
        .from("invoice_settings")
        .select("brand_color")
        .eq("business_id", proforma.business_id)
        .maybeSingle(),
    ])

    return NextResponse.json({
      proforma,
      items: items ?? [],
      business: biz ?? null,
      settings: settings ?? null,
    })
  } catch (err: any) {
    console.error("public/proforma GET error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
