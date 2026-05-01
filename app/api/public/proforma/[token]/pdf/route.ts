import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { buildProformaFinancialDocumentHtmlForPdf } from "@/lib/documents/buildProformaFinancialDocumentHtmlForPdf"
import {
  loadInvoiceSettingsForDocument,
  mergeQuotePdfTerms,
} from "@/lib/invoices/loadInvoiceSettingsForDocument"
import { buildFinancialDocumentPdfDisposition } from "@/lib/documents/financialDocumentPdfDisposition"
import { renderHtmlToPdfBuffer } from "@/lib/pdf/renderHtmlToPdf"
import {
  PUBLIC_BUSINESS_SELECT,
  PUBLIC_PROFORMA_INVOICE_COLUMNS,
  PUBLIC_PROFORMA_ITEM_SELECT,
} from "@/lib/publicDocuments/publicDocumentSelects"

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
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const supabase = serviceClient()
    const { data: proformaRaw, error } = (await supabase
      .from("proforma_invoices")
      .select(PUBLIC_PROFORMA_INVOICE_COLUMNS)
      .eq("public_token", token)
      .is("deleted_at", null)
      .maybeSingle()) as {
      data: Record<string, unknown> | null
      error: { message?: string } | null
    }

    if (error || !proformaRaw) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const proforma = proformaRaw as Record<string, unknown> & {
      id: string
      business_id: string
      customer_id?: string | null
      proforma_number?: string | null
      payment_terms?: string | null
      footer_message?: string | null
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
        .select(PUBLIC_BUSINESS_SELECT)
        .eq("id", proforma.business_id)
        .single(),
      supabase
        .from("proforma_invoice_items")
        .select(PUBLIC_PROFORMA_ITEM_SELECT)
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
        proforma,
        business: business ?? undefined,
        customer: customer ?? undefined,
        items: items || [],
        payment_terms: quoteTerms.payment_terms,
        footer_message: quoteTerms.footer_message,
        quote_terms: quoteTerms.quote_terms,
        payment_details: invSettings.payment_details,
      })
    } catch (e: unknown) {
      console.error("public proforma PDF build error:", e)
      return NextResponse.json({ error: "Unable to generate PDF" }, { status: 400 })
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderHtmlToPdfBuffer(html)
    } catch (err: unknown) {
      console.error("public proforma PDF (Chromium) failed:", err)
      return NextResponse.json(
        {
          error: "Unable to generate PDF",
          ...(process.env.VERCEL !== "1"
            ? {
                hint: "Install Google Chrome or set PUPPETEER_EXECUTABLE_PATH to your Chrome/Chromium binary.",
              }
            : {}),
        },
        { status: 500 }
      )
    }

    const { contentDisposition } = buildFinancialDocumentPdfDisposition({
      label: "Proforma Invoice",
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
  } catch (error: unknown) {
    console.error("public proforma pdf error:", error)
    return NextResponse.json({ error: "Unable to generate PDF" }, { status: 500 })
  }
}
