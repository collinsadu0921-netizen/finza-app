import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { buildProformaFinancialDocumentHtmlForPdf } from "@/lib/documents/buildProformaFinancialDocumentHtmlForPdf"
import {
  loadInvoiceSettingsForDocument,
  mergeQuotePdfTerms,
} from "@/lib/invoices/loadInvoiceSettingsForDocument"
import { buildFinancialDocumentPdfDisposition } from "@/lib/documents/financialDocumentPdfDisposition"
import { renderHtmlToPdfBuffer } from "@/lib/pdf/renderHtmlToPdf"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

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
        .select(
          "name, legal_name, trading_name, phone, email, address, logo_url, tax_id, registration_number, default_currency"
        )
        .eq("id", proforma.business_id)
        .single(),
      supabase
        .from("proforma_invoice_items")
        .select("id, description, qty, unit_price, discount_amount, line_subtotal, created_at")
        .eq("proforma_invoice_id", proforma.id)
        .order("created_at", { ascending: true }),
    ])

    const invSettings = await loadInvoiceSettingsForDocument(supabase, proforma.business_id)
    const quoteTerms = mergeQuotePdfTerms(invSettings, {
      payment_terms: proforma.payment_terms,
      footer_message: proforma.footer_message,
    })

    let html: string
    try {
      html = buildProformaFinancialDocumentHtmlForPdf({
        proforma: proforma as Record<string, unknown>,
        business: business ?? undefined,
        customer: customer ?? undefined,
        items: items || [],
        payment_terms: quoteTerms.payment_terms,
        footer_message: quoteTerms.footer_message,
        quote_terms: quoteTerms.quote_terms,
      })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to build document"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderHtmlToPdfBuffer(html)
    } catch (err: unknown) {
      console.error("public proforma PDF (Chromium) failed:", err)
      const message = err instanceof Error ? err.message : "PDF generation failed"
      return NextResponse.json(
        {
          error: message,
          hint:
            process.env.VERCEL !== "1"
              ? "Install Google Chrome or set PUPPETEER_EXECUTABLE_PATH to your Chrome/Chromium binary."
              : undefined,
        },
        { status: 500 }
      )
    }

    const { contentDisposition } = buildFinancialDocumentPdfDisposition({
      label: "Proforma",
      documentNumber: proforma.proforma_number,
      fallbackId: proforma.id,
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "no-store",
      },
    })
  } catch (error: any) {
    console.error("public proforma pdf error:", error)
    return NextResponse.json({ error: error.message || "Failed to generate proforma PDF preview" }, { status: 500 })
  }
}
