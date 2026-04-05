import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { buildInvoicePreviewHtmlForId } from "@/lib/invoices/buildInvoicePreviewHtml"
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
      return NextResponse.json({ error: "Invoice ID is required" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const built = await buildInvoicePreviewHtmlForId(supabase, invoiceId)

    if (!built.ok) {
      return NextResponse.json({ error: built.error }, { status: built.status })
    }

    const headers: Record<string, string> = {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    }

    if (wantsDownloadAttachment(request)) {
      const { contentDisposition } = buildInvoiceHtmlAttachmentDisposition(
        built.invoiceNumber,
        built.invoiceId
      )
      headers["Content-Disposition"] = contentDisposition
    }

    return new NextResponse(built.html, { headers })
  } catch (error: unknown) {
    console.error("Error generating preview:", error)
    return NextResponse.json({ error: "Failed to generate preview" }, { status: 500 })
  }
}
