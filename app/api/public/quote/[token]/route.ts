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

const num = (v: unknown) => Number(v ?? 0)

/**
 * Map DB row (varies by migration: expiry vs validity, nhil vs nhil_amount, etc.)
 * to the shape expected by `app/quote-public/[token]/page.tsx`.
 */
function normalizeEstimateForPublic(
  row: Record<string, unknown>,
  customers: { id: string; name: string; email: string | null; phone: string | null; address: string | null } | null
) {
  return {
    id: row.id as string,
    business_id: row.business_id as string,
    estimate_number: row.estimate_number as string,
    issue_date: row.issue_date as string,
    expiry_date: (row.expiry_date ?? row.validity_date ?? null) as string | null,
    notes: (row.notes ?? null) as string | null,
    subtotal: num(row.subtotal),
    nhil_amount: num(row.nhil_amount ?? row.nhil),
    getfund_amount: num(row.getfund_amount ?? row.getfund),
    covid_amount: num(row.covid_amount ?? row.covid),
    vat_amount: num(row.vat_amount ?? row.vat),
    total_tax_amount: num(row.total_tax_amount ?? row.total_tax ?? row.tax),
    total_amount: num(row.total_amount ?? row.total),
    status: row.status as string,
    apply_taxes: Boolean(row.apply_taxes),
    tax_lines: row.tax_lines ?? null,
    currency_code: (row.currency_code ?? null) as string | null,
    currency_symbol: (row.currency_symbol ?? null) as string | null,
    client_name_signed: (row.client_name_signed ?? null) as string | null,
    client_id_type: (row.client_id_type ?? null) as string | null,
    client_id_number: (row.client_id_number ?? null) as string | null,
    client_signature: (row.client_signature ?? null) as string | null,
    signed_at: (row.signed_at ?? null) as string | null,
    rejected_reason: (row.rejected_reason ?? null) as string | null,
    rejected_at: (row.rejected_at ?? null) as string | null,
    customers,
  }
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

    // Avoid PostgREST embed `customers (...)` — relationship hints often break across
    // schema versions and surface as PGRST errors that we were treating as 404.
    const { data: row, error } = await supabase
      .from("estimates")
      .select("*")
      .eq("public_token", token)
      .is("deleted_at", null)
      .maybeSingle()

    if (error) {
      console.error("public/quote GET estimates error:", error.message, error.code, error.details)
      return NextResponse.json({ error: "Quote not found" }, { status: 404 })
    }
    if (!row) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 })
    }

    const customerId = row.customer_id as string | null | undefined
    let customers: {
      id: string
      name: string
      email: string | null
      phone: string | null
      whatsapp_phone: string | null
      address: string | null
      tin: string | null
    } | null = null

    if (customerId) {
      const { data: cust, error: custErr } = await supabase
        .from("customers")
        .select("id, name, email, phone, whatsapp_phone, address, tin")
        .eq("id", customerId)
        .maybeSingle()
      if (custErr) {
        console.error("public/quote GET customer error:", custErr.message)
      }
      customers = cust ?? null
    }

    const estimate = normalizeEstimateForPublic(row as Record<string, unknown>, customers)

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
