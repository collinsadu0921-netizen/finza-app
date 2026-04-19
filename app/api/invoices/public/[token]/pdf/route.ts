import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { buildInvoicePreviewHtmlForPublicToken } from "@/lib/invoices/buildInvoicePreviewHtml"
import { buildInvoicePdfAttachmentDisposition } from "@/lib/invoices/invoiceDocumentAttachment"
import { renderHtmlToPdfBuffer } from "@/lib/pdf/renderHtmlToPdf"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

/**
 * GET /api/invoices/public/[token]/pdf
 * Public binary PDF — same render pipeline as GET /api/invoices/[id]/export-pdf.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> | { token: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const rawToken = (resolvedParams.token || "").trim()
    if (!rawToken) {
      return NextResponse.json({ error: "Public token is required" }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()
    const built = await buildInvoicePreviewHtmlForPublicToken(supabase, rawToken)

    if (!built.ok) {
      return NextResponse.json({ error: built.error }, { status: built.status })
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderHtmlToPdfBuffer(built.html)
    } catch (err: unknown) {
      console.error("public invoice PDF (Chromium) failed:", err)
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

    const { contentDisposition } = buildInvoicePdfAttachmentDisposition(built.invoiceNumber, built.invoiceId)

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "no-store",
      },
    })
  } catch (error: unknown) {
    console.error("public invoice pdf error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to export PDF" },
      { status: 500 }
    )
  }
}
