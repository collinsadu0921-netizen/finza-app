import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { buildInvoicePreviewHtmlForId } from "@/lib/invoices/buildInvoicePreviewHtml"
import { buildInvoicePdfAttachmentDisposition } from "@/lib/invoices/invoiceDocumentAttachment"
import { renderHtmlToPdfBuffer } from "@/lib/pdf/renderHtmlToPdf"

export const runtime = "nodejs"
/** Vercel Pro+ can raise this; Hobby may cap lower — PDF generation needs headless Chrome. */
export const maxDuration = 60

/**
 * GET /api/invoices/[id]/export-pdf
 * Authenticated: returns application/pdf (binary), same visual as pdf-preview HTML.
 * Query: business_id optional (same session/RLS as other invoice APIs).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const invoiceId = resolvedParams.id

    if (!invoiceId) {
      return NextResponse.json({ error: "Invoice ID is required" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const built = await buildInvoicePreviewHtmlForId(supabase, invoiceId)
    if (!built.ok) {
      return NextResponse.json({ error: built.error }, { status: built.status })
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderHtmlToPdfBuffer(built.html)
    } catch (err: unknown) {
      console.error("Invoice PDF (Chromium) failed:", err)
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

    const { contentDisposition } = buildInvoicePdfAttachmentDisposition(
      built.invoiceNumber,
      built.invoiceId
    )

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "no-store",
      },
    })
  } catch (error: unknown) {
    console.error("export-pdf error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to export PDF" },
      { status: 500 }
    )
  }
}
