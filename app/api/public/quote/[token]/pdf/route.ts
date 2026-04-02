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
import { estimateLineItemDiscount } from "@/lib/documents/estimateLineItemDiscount"
import { taxLinesFromEstimateRow } from "@/lib/documents/estimateTaxLinesForDocument"

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
      return NextResponse.json({ error: "Quote not found" }, { status: 404 })
    }

    const supabase = serviceClient()
    const { data: estimate, error } = await supabase
      .from("estimates")
      .select("*")
      .eq("public_token", token)
      .is("deleted_at", null)
      .maybeSingle()

    if (error || !estimate) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 })
    }

    const [{ data: customer }, { data: business }, { data: items }] = await Promise.all([
      estimate.customer_id
        ? supabase
            .from("customers")
            .select("id, name, email, phone, whatsapp_phone, address")
            .eq("id", estimate.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("businesses")
        .select("name, legal_name, trading_name, phone, email, address, logo_url, tax_id, registration_number, default_currency")
        .eq("id", estimate.business_id)
        .single(),
      supabase
        .from("estimate_items")
        .select("*")
        .eq("estimate_id", estimate.id)
        .order("created_at", { ascending: true }),
    ])

    const currencyCode = estimate.currency_code || business?.default_currency
    if (!currencyCode) {
      return NextResponse.json({ error: "Quote currency is missing" }, { status: 400 })
    }
    const currencySymbol = estimate.currency_symbol || getCurrencySymbol(currencyCode)

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
      const qty = Number(item.quantity ?? item.qty ?? 0)
      const unitPrice = Number(item.price ?? item.unit_price ?? 0)
      const lineNet = Number(item.total ?? item.line_total ?? 0)
      return {
        id: item.id,
        description: item.description || "Item",
        qty,
        unit_price: unitPrice,
        discount_amount: estimateLineItemDiscount(item),
        line_subtotal: lineNet,
      }
    })

    const totals: DocumentTotals = {
      subtotal: Number(estimate.subtotal || 0),
      total_tax: Number(estimate.total_tax_amount ?? estimate.total_tax ?? 0),
      total: Number(estimate.total_amount ?? estimate.total ?? 0),
      nhil_amount: Number(estimate.nhil_amount ?? estimate.nhil ?? 0),
      getfund_amount: Number(estimate.getfund_amount ?? estimate.getfund ?? 0),
      covid_amount: Number(estimate.covid_amount ?? estimate.covid ?? 0),
      vat_amount: Number(estimate.vat_amount ?? estimate.vat ?? 0),
    }

    const acceptedNote =
      estimate.status === "accepted" && estimate.client_name_signed
        ? `\n\nAccepted by ${estimate.client_name_signed}${estimate.signed_at ? ` on ${new Date(estimate.signed_at).toLocaleDateString("en-GB")}` : ""}.`
        : ""

    const parsedTaxLines = taxLinesFromEstimateRow(estimate as Record<string, unknown>)

    const html = generateFinancialDocumentHTML({
      documentType: "estimate",
      business: businessInfo,
      customer: customerInfo,
      items: documentItems,
      totals,
      tax_lines: parsedTaxLines.length > 0 ? parsedTaxLines : undefined,
      meta: {
        document_number: estimate.estimate_number || "QUOTE",
        issue_date: estimate.issue_date,
        expiry_date: estimate.expiry_date || estimate.validity_date || null,
        status: estimate.status || null,
        public_token: estimate.public_token || null,
      } as DocumentMeta,
      notes: `${estimate.notes || ""}${acceptedNote}`.trim() || null,
      apply_taxes: Boolean(estimate.apply_taxes),
      currency_code: currencyCode,
      currency_symbol: currencySymbol,
      fx_rate: estimate.fx_rate ?? null,
      home_currency_code: estimate.home_currency_code ?? null,
      home_currency_total: estimate.home_currency_total ?? null,
    })

    // Inject auto-print script so the browser's Print / Save as PDF dialog fires
    // immediately when the tab opens — this is what makes "Download / Print PDF" work.
    const printableHtml = html.replace(
      "</body>",
      `<script>window.onload = function() { window.print(); }</script></body>`
    )

    return new NextResponse(printableHtml, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="quote-${estimate.estimate_number || estimate.id}.html"`,
      },
    })
  } catch (error: any) {
    console.error("public quote pdf error:", error)
    return NextResponse.json({ error: error.message || "Failed to generate quote PDF preview" }, { status: 500 })
  }
}

