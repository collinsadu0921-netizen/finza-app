import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { buildEstimateFinancialDocumentHtmlForPdf } from "@/lib/documents/buildEstimateFinancialDocumentHtmlForPdf"
import {
  loadInvoiceSettingsForDocument,
  mergeQuotePdfTerms,
} from "@/lib/invoices/loadInvoiceSettingsForDocument"
import { buildFinancialDocumentPdfDisposition } from "@/lib/documents/financialDocumentPdfDisposition"
import { renderHtmlToPdfBuffer } from "@/lib/pdf/renderHtmlToPdf"
import { PUBLIC_BUSINESS_SELECT, PUBLIC_ESTIMATE_ITEM_SELECT } from "@/lib/publicDocuments/publicDocumentSelects"
import { fetchPublicEstimateRowByToken } from "@/lib/publicDocuments/fetchPublicEstimateRowByToken"
import { logPublicQuoteEstimateFetch } from "@/lib/publicDocuments/publicQuoteRouteDiagnostics"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
/** Same headless Chromium path as invoice export-pdf. */
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
    const { data: estimate, error, columnVariant } = await fetchPublicEstimateRowByToken(supabase, token)

    if (error) {
      logPublicQuoteEstimateFetch({
        token,
        outcome: "supabase_error",
        error: error as { message?: string; code?: string; details?: string; hint?: string },
      })
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }
    if (!estimate) {
      logPublicQuoteEstimateFetch({ token, outcome: "no_row" })
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const tokenLength = token.length
    const tokenPrefix =
      tokenLength === 0 ? "" : `${token.slice(0, Math.min(6, tokenLength))}${tokenLength > 6 ? "…" : ""}`
    console.info(
      "[public-quote] pdf estimate row loaded",
      JSON.stringify({ tokenLength, tokenPrefix, columnVariant })
    )

    const est = estimate as Record<string, unknown> & {
      id: string
      business_id: string
      customer_id?: string | null
      estimate_number?: string | null
    }

    const [{ data: customer }, { data: business }, { data: items }] = await Promise.all([
      est.customer_id
        ? supabase
            .from("customers")
            .select("id, name, email, phone, whatsapp_phone, address")
            .eq("id", est.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("businesses")
        .select(PUBLIC_BUSINESS_SELECT)
        .eq("id", est.business_id)
        .single(),
      supabase
        .from("estimate_items")
        .select(PUBLIC_ESTIMATE_ITEM_SELECT)
        .eq("estimate_id", est.id)
        .order("created_at", { ascending: true }),
    ])

    const invSettings = await loadInvoiceSettingsForDocument(supabase, est.business_id)
    const quoteTerms = mergeQuotePdfTerms(invSettings, null)

    let html: string
    try {
      html = buildEstimateFinancialDocumentHtmlForPdf({
        estimate: est,
        business: business ?? undefined,
        customer: customer ?? undefined,
        items: items || [],
        payment_terms: quoteTerms.payment_terms,
        footer_message: quoteTerms.footer_message,
        quote_terms: quoteTerms.quote_terms,
      })
    } catch (e: unknown) {
      console.error("public quote PDF build error:", e)
      return NextResponse.json({ error: "Unable to generate PDF" }, { status: 400 })
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderHtmlToPdfBuffer(html)
    } catch (err: unknown) {
      console.error("public quote PDF (Chromium) failed:", err)
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
      label: "Quote",
      documentNumber: est.estimate_number,
      fallbackId: est.id,
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "no-store",
      },
    })
  } catch (error: unknown) {
    console.error("public quote pdf error:", error)
    return NextResponse.json({ error: "Unable to generate PDF" }, { status: 500 })
  }
}
