import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { buildEstimateFinancialDocumentHtmlForPdf } from "@/lib/documents/buildEstimateFinancialDocumentHtmlForPdf"
import { buildFinancialDocumentPdfDisposition } from "@/lib/documents/financialDocumentPdfDisposition"
import { renderHtmlToPdfBuffer } from "@/lib/pdf/renderHtmlToPdf"

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
        .select(
          "name, legal_name, trading_name, phone, email, address, logo_url, tax_id, registration_number, default_currency"
        )
        .eq("id", estimate.business_id)
        .single(),
      supabase
        .from("estimate_items")
        .select("*")
        .eq("estimate_id", estimate.id)
        .order("created_at", { ascending: true }),
    ])

    let html: string
    try {
      html = buildEstimateFinancialDocumentHtmlForPdf({
        estimate: estimate as Record<string, unknown>,
        business: business ?? undefined,
        customer: customer ?? undefined,
        items: items || [],
      })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to build document"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderHtmlToPdfBuffer(html)
    } catch (err: unknown) {
      console.error("public quote PDF (Chromium) failed:", err)
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
      label: "Quote",
      documentNumber: estimate.estimate_number,
      fallbackId: estimate.id,
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "no-store",
      },
    })
  } catch (error: any) {
    console.error("public quote pdf error:", error)
    return NextResponse.json({ error: error.message || "Failed to generate quote PDF preview" }, { status: 500 })
  }
}
