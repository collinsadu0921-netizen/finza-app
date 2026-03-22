/**
 * POST /api/invoices/preview-draft
 *
 * Renders invoice preview from form state only. No DB insert, no invoice number,
 * no ledger post. Uses same renderer as GET /api/invoices/[id]/pdf-preview and
 * POST /api/invoices/preview. For use during invoice creation before save.
 *
 * Payload: same shape as invoice creation form (customer_id, items, issue_date,
 * due_date, notes, apply_taxes, business_id, currency_code, etc.).
 * invoice_number is not required; document displays as "DRAFT".
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { calculateTaxes } from "@/lib/taxEngine"
import {
  generateFinancialDocumentHTML,
  type BusinessInfo,
  type CustomerInfo,
  type DocumentItem,
  type DocumentMeta,
  type DocumentTotals,
} from "@/components/documents/FinancialDocument"
import { getCurrencySymbol } from "@/lib/currency"

const DRAFT_BANNER_HTML = `
<div style="background: #fef3c7; border-bottom: 2px solid #f59e0b; color: #92400e; padding: 10px 20px; font-weight: 600; text-align: center;">
  DRAFT PREVIEW – Not saved
</div>
`

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const {
      customer_id,
      issue_date,
      due_date,
      notes,
      footer_message,
      apply_taxes,
      items,
      currency_symbol,
      currency_code,
      wht_applicable,
      wht_rate,
    } = body

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }
    const finalBusinessId = business.id

    const { data: businessDetails, error: businessError } = await supabase
      .from("businesses")
      .select(
        "name, legal_name, trading_name, phone, email, address, logo_url, tax_id, registration_number, address_country, default_currency"
      )
      .eq("id", finalBusinessId)
      .single()

    if (businessError || !businessDetails) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const businessCurrencyCode = currency_code || businessDetails.default_currency
    if (!businessCurrencyCode) {
      return NextResponse.json(
        {
          error:
            "Business currency is required. Please set your default currency in Business Profile settings.",
        },
        { status: 400 }
      )
    }

    const businessCurrencySymbol =
      currency_symbol || getCurrencySymbol(businessCurrencyCode)

    let customer: { id?: string; name?: string; email?: string | null; phone?: string | null; whatsapp_phone?: string | null; address?: string | null } | null = null
    if (customer_id) {
      const { data: cust } = await supabase
        .from("customers")
        .select("id, name, email, phone, whatsapp_phone, address")
        .eq("id", customer_id)
        .single()
      customer = cust
    }

    const businessData: BusinessInfo = {
      name: businessDetails.name,
      legal_name: businessDetails.legal_name,
      trading_name: businessDetails.trading_name,
      phone: businessDetails.phone,
      email: businessDetails.email,
      address: businessDetails.address,
      logo_url: businessDetails.logo_url,
      tax_id: businessDetails.tax_id,
      registration_number: businessDetails.registration_number,
    }

    const customerData: CustomerInfo = {
      id: customer?.id,
      name: customer?.name ?? "—",
      email: customer?.email ?? null,
      phone: customer?.phone ?? null,
      whatsapp_phone: customer?.whatsapp_phone ?? null,
      address: customer?.address ?? null,
    }

    const lineItems = (items || []).map((item: any) => ({
      quantity: Number(item.qty ?? item.quantity ?? 0),
      unit_price: Number(item.unit_price ?? item.price ?? 0),
      discount_amount: Number(item.discount_amount ?? 0),
    }))

    const effectiveDate = issue_date || new Date().toISOString().split("T")[0]
    let subtotal = 0
    let total = 0
    let totalTax = 0
    let taxCalculationResult: ReturnType<typeof calculateTaxes> | undefined

    if (apply_taxes && lineItems.length > 0) {
      taxCalculationResult = calculateTaxes(
        lineItems,
        businessDetails?.address_country ?? null,
        effectiveDate,
        true
      )
      subtotal = taxCalculationResult.subtotal_excl_tax
      totalTax = taxCalculationResult.tax_total
      total = taxCalculationResult.total_incl_tax
    } else {
      subtotal = lineItems.reduce((sum: number, item: any) => {
        const lineTotal = item.quantity * item.unit_price
        const discount = item.discount_amount || 0
        return sum + lineTotal - discount
      }, 0)
      total = subtotal
      totalTax = 0
    }

    const documentItems: DocumentItem[] = (items || []).map((item: any) => {
      const qty = Number(item.qty ?? item.quantity ?? 0)
      const price = Number(item.unit_price ?? item.price ?? 0)
      const discount = Number(item.discount_amount ?? 0)
      const lineTotal = qty * price - discount
      return {
        id: item.id,
        description: item.description || "Item",
        qty,
        unit_price: price,
        discount_amount: discount,
        line_subtotal: lineTotal,
      }
    })

    // WHT: applied on pre-tax base (subtotal), not on VAT-inclusive total
    const whtAmount = (wht_applicable && wht_rate && subtotal > 0)
      ? Math.round(subtotal * Number(wht_rate) * 100) / 100
      : 0

    const documentTotals: DocumentTotals = {
      subtotal,
      total_tax: totalTax,
      total,
      ...(wht_applicable && whtAmount > 0 ? {
        wht_applicable: true,
        wht_rate:       Number(wht_rate),
        wht_amount:     whtAmount,
        net_payable:    Math.round((total - whtAmount) * 100) / 100,
      } : {}),
    }

    const documentMeta: DocumentMeta = {
      document_number: "DRAFT",
      issue_date: effectiveDate,
      due_date: due_date || null,
    }

    const htmlBody = generateFinancialDocumentHTML({
      documentType: "invoice",
      business: businessData,
      customer: customerData,
      items: documentItems,
      totals: documentTotals,
      meta: documentMeta,
      notes: notes ?? null,
      footer_message: footer_message ?? null,
      apply_taxes: Boolean(apply_taxes),
      currency_symbol: businessCurrencySymbol,
      currency_code: businessCurrencyCode,
      tax_lines: taxCalculationResult?.taxLines,
      business_country: businessDetails?.address_country ?? null,
    })

    const htmlWithBanner = htmlBody.replace(
      "<body>",
      "<body>" + DRAFT_BANNER_HTML
    )

    return new NextResponse(htmlWithBanner, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    })
  } catch (error: unknown) {
    console.error("Error generating draft preview:", error)
    return NextResponse.json(
      { error: "Failed to generate draft preview" },
      { status: 500 }
    )
  }
}
