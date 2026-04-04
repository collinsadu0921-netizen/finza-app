import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { generateFinancialDocumentHTML, type BusinessInfo, type CustomerInfo, type DocumentItem, type DocumentMeta, type DocumentTotals } from "@/components/documents/FinancialDocument"
import { jsonbToTaxResult } from "@/lib/taxEngine/helpers"
import { buildInvoiceHtmlAttachmentDisposition } from "@/lib/invoices/invoiceDocumentAttachment"

function wantsDownloadAttachment(request: NextRequest): boolean {
  const v = request.nextUrl.searchParams.get("download")
  return v === "1" || v === "true" || v === "yes"
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const invoiceId = resolvedParams.id

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Invoice ID is required" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()
    
    // Fetch invoice with all related data
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select(`
        *,
        customers (
          id,
          name,
          email,
          phone,
          whatsapp_phone,
          address
        ),
        businesses (
          id,
          name,
          legal_name,
          trading_name,
          phone,
          email,
          address,
          logo_url,
          tax_id,
          registration_number,
          address_country
        ),
        invoice_items (
          id,
          description,
          qty,
          unit_price,
          discount_amount,
          line_subtotal
        )
      `)
      .eq("id", invoiceId)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404 }
      )
    }

    // Generate HTML using shared document component
    const business: BusinessInfo = {
      name: invoice.businesses?.name,
      legal_name: invoice.businesses?.legal_name,
      trading_name: invoice.businesses?.trading_name,
      phone: invoice.businesses?.phone,
      email: invoice.businesses?.email,
      address: invoice.businesses?.address,
      logo_url: invoice.businesses?.logo_url,
      tax_id: invoice.businesses?.tax_id,
      registration_number: invoice.businesses?.registration_number,
    }

    const customer: CustomerInfo = {
      id: invoice.customers?.id,
      name: invoice.customers?.name,
      email: invoice.customers?.email,
      phone: invoice.customers?.phone,
      whatsapp_phone: invoice.customers?.whatsapp_phone,
      address: invoice.customers?.address,
    }

    const documentItems: DocumentItem[] = (invoice.invoice_items || []).map((item: any) => ({
      id: item.id,
      description: item.description || "Item",
      qty: item.qty || 0,
      unit_price: item.unit_price || 0,
      discount_amount: Number(item.discount_amount) || 0,
      line_subtotal: item.line_subtotal || 0,
    }))

    // Parse tax_lines from stored JSONB if available (preferred source of truth)
    const storedTaxResult = invoice.tax_lines ? jsonbToTaxResult(invoice.tax_lines) : null
    const taxLines = storedTaxResult?.taxLines || []

    const invoiceTotal     = Number(invoice.total || 0)
    const whtApplicable    = Boolean(invoice.wht_receivable_applicable)
    const whtRate          = Number(invoice.wht_receivable_rate  || 0)
    const whtAmount        = Number(invoice.wht_receivable_amount || 0)

    const documentTotals: DocumentTotals = {
      subtotal: Number(invoice.subtotal || 0),
      total_tax: Number(invoice.total_tax || 0),
      total: invoiceTotal,
      tax_lines: taxLines,
      // Legacy fields kept for backward compatibility but not used for rendering
      nhil_amount: Number(invoice.nhil || 0),
      getfund_amount: Number(invoice.getfund || 0),
      covid_amount: Number(invoice.covid || 0),
      vat_amount: Number(invoice.vat || 0),
      // WHT deduction — shown when customer withholds tax at source
      ...(whtApplicable && whtAmount > 0 ? {
        wht_applicable: true,
        wht_rate:       whtRate,
        wht_amount:     whtAmount,
        net_payable:    Math.round((invoiceTotal - whtAmount) * 100) / 100,
      } : {}),
    }

    const documentMeta: DocumentMeta = {
      document_number: invoice.invoice_number || "DRAFT",
      issue_date: invoice.issue_date,
      due_date: invoice.due_date || null,
      status: invoice.status || null,
      public_token: invoice.public_token || null,
    }

    // Require currency for PDF generation - invoices should always have currency
    if (!invoice.currency_code) {
      return NextResponse.json(
        { error: "Invoice currency code is required for PDF generation. This invoice appears to be missing currency information." },
        { status: 400 }
      )
    }

    if (!invoice.currency_symbol) {
      return NextResponse.json(
        { error: "Invoice currency symbol is required for PDF generation. This invoice appears to be missing currency information." },
        { status: 400 }
      )
    }

    const htmlPreview = generateFinancialDocumentHTML({
      documentType: "invoice",
      business,
      customer,
      items: documentItems,
      totals: documentTotals,
      meta: documentMeta,
      notes: invoice.notes || null,
      footer_message: invoice.footer_message || null,
      apply_taxes: invoice.apply_taxes || false,
      currency_symbol: invoice.currency_symbol,
      currency_code: invoice.currency_code,
      // Use stored tax_lines from database (preferred over recalculating)
      tax_lines: taxLines.length > 0 ? taxLines : undefined,
      business_country: invoice.businesses?.address_country || null,
      // FX fields
      fx_rate: invoice.fx_rate ?? null,
      home_currency_code: invoice.home_currency_code ?? null,
      home_currency_total: invoice.home_currency_total ?? null,
    })

    const headers: Record<string, string> = {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    }

    if (wantsDownloadAttachment(request)) {
      const { contentDisposition } = buildInvoiceHtmlAttachmentDisposition(
        invoice.invoice_number,
        invoice.id
      )
      headers["Content-Disposition"] = contentDisposition
    }

    return new NextResponse(htmlPreview, { headers })
  } catch (error: any) {
    console.error("Error generating preview:", error)
    return NextResponse.json(
      { error: "Failed to generate preview" },
      { status: 500 }
    )
  }
}

