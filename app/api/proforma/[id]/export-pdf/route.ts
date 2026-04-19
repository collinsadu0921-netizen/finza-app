import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
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

/**
 * GET /api/proforma/[id]/export-pdf?business_id=
 * Authenticated: binary PDF for staff — same render as public token PDF.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const proformaId = resolvedParams.id
    if (!proformaId) {
      return NextResponse.json({ error: "Proforma invoice ID is required" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const requestedBusinessId = new URL(request.url).searchParams.get("business_id")
    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const { data: proforma, error: proformaError } = await supabase
      .from("proforma_invoices")
      .select("*")
      .eq("id", proformaId)
      .eq("business_id", scope.businessId)
      .is("deleted_at", null)
      .single()

    if (proformaError || !proforma) {
      return NextResponse.json({ error: "Proforma invoice not found" }, { status: 404 })
    }

    const [{ data: business }, { data: items }] = await Promise.all([
      supabase
        .from("businesses")
        .select(
          "name, legal_name, trading_name, phone, email, address, logo_url, tax_id, registration_number, default_currency"
        )
        .eq("id", scope.businessId)
        .single(),
      supabase
        .from("proforma_invoice_items")
        .select("id, description, qty, unit_price, discount_amount, line_subtotal, created_at")
        .eq("proforma_invoice_id", proformaId)
        .order("created_at", { ascending: true }),
    ])

    let customer: {
      id: string
      name: string
      email: string | null
      phone: string | null
      whatsapp_phone: string | null
      address: string | null
    } | null = null
    if (proforma.customer_id) {
      const { data: cust } = await supabase
        .from("customers")
        .select("id, name, email, phone, whatsapp_phone, address")
        .eq("id", proforma.customer_id)
        .maybeSingle()
      customer = cust ?? null
    }

    const invSettings = await loadInvoiceSettingsForDocument(supabase, scope.businessId)
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
        payment_details: invSettings.payment_details,
      })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to build document"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderHtmlToPdfBuffer(html)
    } catch (err: unknown) {
      console.error("proforma export-pdf (Chromium) failed:", err)
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
    console.error("proforma export-pdf error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to export PDF" },
      { status: 500 }
    )
  }
}
