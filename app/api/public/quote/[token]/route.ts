import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

/** Public quote access must bypass RLS; anon key cannot read estimates (business-only policies). */
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
      return NextResponse.json({ error: "Quote not found" }, { status: 404 })
    }

    const supabase = serviceClient()

    const { data: estimate, error } = await supabase
      .from("estimates")
      .select(`
        id, business_id, estimate_number, issue_date, expiry_date, notes,
        subtotal, nhil_amount, getfund_amount, covid_amount, vat_amount,
        total_tax_amount, total_amount, status, apply_taxes,
        tax_lines, currency_code, currency_symbol,
        client_name_signed, client_id_type, client_id_number,
        client_signature, signed_at, rejected_reason, rejected_at,
        customers ( id, name, email, phone, address )
      `)
      .eq("public_token", token)
      .is("deleted_at", null)
      .single()

    if (error || !estimate) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 })
    }

    const [{ data: items }, { data: biz }, { data: settings }] = await Promise.all([
      supabase
        .from("estimate_items")
        .select("id, description, quantity, price, total")
        .eq("estimate_id", estimate.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("businesses")
        .select("legal_name, trading_name, address_street, address_city, address_region, phone, email, website, tin, logo_url")
        .eq("id", estimate.business_id)
        .single(),
      supabase
        .from("invoice_settings")
        .select("brand_color, bank_name, bank_account_name, bank_account_number, momo_provider, momo_name, momo_number, quote_terms_and_conditions")
        .eq("business_id", estimate.business_id)
        .maybeSingle(),
    ])

    return NextResponse.json({
      estimate,
      items: items ?? [],
      business: biz ?? null,
      settings: settings ?? null,
    })
  } catch (err: any) {
    console.error("public/quote GET error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
