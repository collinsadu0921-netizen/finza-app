import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  generateFinancialDocumentHTML,
  type BusinessInfo,
  type CustomerInfo,
  type DocumentItem,
  type DocumentMeta,
  type DocumentTotals,
} from "@/components/documents/FinancialDocument"
import { getCurrencySymbol } from "@/lib/currency"

export const dynamic = "force-dynamic"

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(
  _request: NextRequest,
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
      .select("*")
      .eq("public_token", token)
      .is("deleted_at", null)
      .maybeSingle()

    if (error || !proforma) {
      return NextResponse.json({ error: "Proforma not found" }, { status: 404 })
    }

    const [{ data: customer }, { data: business }, { data: items }] = await Promise.all([
      proforma.customer_id
        ? supabase
            .from("customers")
            .select("id, name, email, phone, whatsapp_phone, address")
            .eq("id", proforma.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("businesses")
        .select("name, legal_name, trading_name, phone, email, address, logo_url, tax_id, registration_number, default_currency")
        .eq("id", proforma.business_id)
        .single(),
      supabase
        .from("proforma_invoice_items")
        .select("id, description, qty, unit_price, line_subtotal")
        .eq("proforma_invoice_id", proforma.id)
        .order("created_at", { ascending: true }),
    ])

    const currencyCode = proforma.currency_code || business?.default_currency
    if (!currencyCode) {
      return NextResponse.json({ error: "Proforma currency is missing" }, { status: 400 })
    }
    const currencySymbol = proforma.currency_symbol || getCurrencySymbol(currencyCode)

    const businessInfo: BusinessInfo = {
      name: business?.name,
      legal_name: business?.legal_name,
      trading_name: business?.trading_name,
      phone: business?.phone,
      email: business?.email,
      address: business?.address,
      logo_url: business?.logo_url,
      tax_id: business?.tax_id,
      registration_number: business?.registration_number,
    }

    const customerInfo: CustomerInfo = customer
      ? {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          whatsapp_phone: customer.whatsapp_phone,
          address: customer.address,
        }
      : { name: "Customer" }

    const documentItems: DocumentItem[] = (items || []).map((item: any) => {
      const qty = Number(item.qty) || 0
      const unitPrice = Number(item.unit_price) || 0
      const discount = Number(item.discount_amount) || 0
      const stored =
        item.line_subtotal != null ? Number(item.line_subtotal) : undefined
      return {
        id: item.id,
        description: item.description || "Item",
        qty,
        unit_price: unitPrice,
        discount_amount: discount,
        ...(stored !== undefined ? { line_subtotal: stored } : {}),
      }
    })

    const totals: DocumentTotals = {
      subtotal: Number(proforma.subtotal || 0),
      total_tax: Number(proforma.total_tax || 0),
      total: Number(proforma.total || 0),
      nhil_amount: Number(proforma.nhil || 0),
      getfund_amount: Number(proforma.getfund || 0),
      covid_amount: Number(proforma.covid || 0),
      vat_amount: Number(proforma.vat || 0),
    }

    const acceptedNote =
      proforma.status === "accepted" && proforma.client_name_signed
        ? `\n\nAccepted by ${proforma.client_name_signed}${proforma.signed_at ? ` on ${new Date(proforma.signed_at).toLocaleDateString("en-GB")}` : ""}.`
        : ""

    const html = generateFinancialDocumentHTML({
      documentType: "estimate",
      business: businessInfo,
      customer: customerInfo,
      items: documentItems,
      totals,
      meta: {
        document_number: proforma.proforma_number || "PROFORMA",
        issue_date: proforma.issue_date,
        expiry_date: proforma.validity_date || null,
        status: proforma.status || null,
        public_token: proforma.public_token || null,
      } as DocumentMeta,
      notes: `${proforma.notes || ""}${acceptedNote}`.trim() || null,
      footer_message: proforma.footer_message || null,
      apply_taxes: Boolean(proforma.apply_taxes),
      currency_code: currencyCode,
      currency_symbol: currencySymbol,
      fx_rate: proforma.fx_rate ?? null,
      home_currency_code: proforma.home_currency_code ?? null,
      home_currency_total: proforma.home_currency_total ?? null,
    })

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="proforma-${proforma.proforma_number || proforma.id}.html"`,
      },
    })
  } catch (error: any) {
    console.error("public proforma pdf error:", error)
    return NextResponse.json({ error: error.message || "Failed to generate proforma PDF preview" }, { status: 500 })
  }
}

