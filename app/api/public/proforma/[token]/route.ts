import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  loadInvoiceSettingsForDocument,
  mergeQuotePdfTerms,
} from "@/lib/invoices/loadInvoiceSettingsForDocument"
import {
  PUBLIC_BUSINESS_SELECT,
  PUBLIC_PROFORMA_INVOICE_COLUMNS,
  PUBLIC_PROFORMA_ITEM_SELECT,
} from "@/lib/publicDocuments/publicDocumentSelects"

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
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const supabase = serviceClient()

    const { data: row, error } = (await supabase
      .from("proforma_invoices")
      .select(PUBLIC_PROFORMA_INVOICE_COLUMNS)
      .eq("public_token", token)
      .is("deleted_at", null)
      .maybeSingle()) as {
      data: Record<string, unknown> | null
      error: { message?: string } | null
    }

    if (error) {
      console.error("public/proforma GET error:", error.message)
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }
    if (!row) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const pRow = row as Record<string, unknown> & {
      id: string
      business_id: string
      payment_terms?: string | null
      footer_message?: string | null
    }

    const customerId = pRow.customer_id as string | null | undefined
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

    const invSettings = await loadInvoiceSettingsForDocument(supabase, pRow.business_id)
    const merged = mergeQuotePdfTerms(invSettings, {
      payment_terms: pRow.payment_terms,
      footer_message: pRow.footer_message,
    })

    const proforma = {
      ...pRow,
      customers,
      payment_terms: merged.payment_terms,
      footer_message: merged.footer_message,
    }

    const [{ data: items }, { data: biz }, { data: settingsRow }] = await Promise.all([
      supabase
        .from("proforma_invoice_items")
        .select(PUBLIC_PROFORMA_ITEM_SELECT)
        .eq("proforma_invoice_id", pRow.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("businesses")
        .select(PUBLIC_BUSINESS_SELECT)
        .eq("id", pRow.business_id)
        .single(),
      supabase
        .from("invoice_settings")
        .select("brand_color")
        .eq("business_id", pRow.business_id)
        .maybeSingle(),
    ])

    return NextResponse.json({
      proforma,
      items: items ?? [],
      business: biz ?? null,
      settings: {
        brand_color: settingsRow?.brand_color ?? null,
        quote_terms_and_conditions: merged.quote_terms,
        payment_details: invSettings.payment_details,
      },
    })
  } catch (err: unknown) {
    console.error("public/proforma GET error:", err)
    return NextResponse.json({ error: "Unable to load document" }, { status: 500 })
  }
}
