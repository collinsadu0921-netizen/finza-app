import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { buildCreditNoteDocumentHtml } from "@/lib/creditNotes/buildCreditNoteDocumentHtml"
import { buildCreditNotePdfAttachmentDisposition } from "@/lib/creditNotes/creditNotePdfAttachment"
import { renderHtmlToPdfBuffer } from "@/lib/pdf/renderHtmlToPdf"

export const runtime = "nodejs"
/** Same ceiling as invoice PDF — Chromium render can be slow on cold start. */
export const maxDuration = 60

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const creditNoteId = resolvedParams.id

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

    const denied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId: business.id,
      minTier: "starter",
    })
    if (denied) return denied

    const built = await buildCreditNoteDocumentHtml(supabase, creditNoteId, {
      restrictBusinessId: business.id,
    })

    if (!built.ok) {
      return NextResponse.json({ error: built.error }, { status: built.status })
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderHtmlToPdfBuffer(built.html)
    } catch (err: unknown) {
      console.error("Credit note PDF (Chromium) failed:", err)
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

    const { contentDisposition } = buildCreditNotePdfAttachmentDisposition(built.creditNumber)

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "no-store",
      },
    })
  } catch (error: unknown) {
    console.error("Credit note export-pdf error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to export PDF" },
      { status: 500 }
    )
  }
}
