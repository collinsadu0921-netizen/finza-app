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

    const { data: row, error } = await supabase
      .from("proforma_invoices")
      .select("*")
      .eq("public_token", token)
      .is("deleted_at", null)
      .maybeSingle()

    if (error) {
      console.error("public/proforma GET error:", error.message)
      return NextResponse.json({ error: "Proforma not found" }, { status: 404 })
    }
    if (!row) {
      return NextResponse.json({ error: "Proforma not found" }, { status: 404 })
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
      if (custErr) console.error("public/proforma GET customer:", custErr.message)
      customers = cust ?? null
    }

    const proforma = { ...row, customers }

    const [{ data: items }, { data: biz }, { data: settings }] = await Promise.all([
      supabase
        .from("proforma_invoice_items")
        .select("id, description, qty, unit_price, discount_amount, line_subtotal")
        .eq("proforma_invoice_id", row.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("businesses")
        .select("legal_name, trading_name, address_street, address_city, address_region, phone, email, website, tin, logo_url")
        .eq("id", row.business_id as string)
        .single(),
      supabase
        .from("invoice_settings")
        .select("brand_color")
        .eq("business_id", row.business_id as string)
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
