import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { buildFinancialDocumentPdfDisposition } from "@/lib/documents/financialDocumentPdfDisposition"
import { renderHtmlToPdfBuffer } from "@/lib/pdf/renderHtmlToPdf"
import { buildProposalHtmlForPdf } from "@/lib/proposals/buildProposalHtmlForPdf"
import { assembleProposalRenderModel, type ProposalAssetRow, type ProposalRow } from "@/lib/proposals/assembleRenderModel"
import type { ProposalRenderBusiness, ProposalRenderCustomer } from "@/lib/proposals/renderModel"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

async function loadBusinessCustomer(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string | null
): Promise<{ business: ProposalRenderBusiness; customer: ProposalRenderCustomer | null }> {
  const { data: business } = await supabase
    .from("businesses")
    .select("name, legal_name, trading_name, logo_url, email, phone, address, default_currency")
    .eq("id", businessId)
    .maybeSingle()

  const b: ProposalRenderBusiness = {
    name: (business?.name as string) || "Business",
    legal_name: business?.legal_name ?? null,
    trading_name: business?.trading_name ?? null,
    logo_url: business?.logo_url ?? null,
    email: business?.email ?? null,
    phone: business?.phone ?? null,
    address: business?.address ?? null,
    default_currency: (business as { default_currency?: string | null })?.default_currency ?? null,
  }

  if (!customerId) return { business: b, customer: null }
  const { data: cust } = await supabase
    .from("customers")
    .select("name, email, phone")
    .eq("id", customerId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .maybeSingle()
  if (!cust) return { business: b, customer: null }
  return {
    business: b,
    customer: { name: cust.name as string, email: cust.email ?? null, phone: cust.phone ?? null },
  }
}

/**
 * GET /api/proposals/[id]/export-pdf?business_id=
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: proposalId } = await Promise.resolve(params)
    if (!proposalId) {
      return NextResponse.json({ error: "Proposal id required" }, { status: 400 })
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
    const businessId = scope.businessId

    const { data: proposal, error: pErr } = await supabase
      .from("proposals")
      .select(
        "id, business_id, customer_id, title, proposal_number, status, template_id, sections, pricing_mode, pricing_payload, currency_code, public_token"
      )
      .eq("id", proposalId)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .maybeSingle()

    if (pErr || !proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
    }

    const { data: assetsRaw } = await supabase
      .from("proposal_assets")
      .select("id, kind, mime_type, file_name, role, visible_on_public, internal_only, sort_order, storage_path")
      .eq("proposal_id", proposalId)
      .order("sort_order", { ascending: true })

    const assets = (assetsRaw || []) as ProposalAssetRow[]

    const { business, customer } = await loadBusinessCustomer(
      supabase,
      businessId,
      proposal.customer_id as string | null
    )

    const { model } = await assembleProposalRenderModel(supabase, {
      proposal: proposal as ProposalRow,
      business,
      customer,
      assets,
      publicView: false,
      signTtlSec: 180,
      includePublicToken: false,
    })

    let html: string
    try {
      html = buildProposalHtmlForPdf(model)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to build document"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderHtmlToPdfBuffer(html)
    } catch (err: unknown) {
      console.error("proposal export-pdf (Chromium) failed:", err)
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
      label: "Proposal",
      documentNumber: (proposal.proposal_number as string | null) || (proposal.title as string | null),
      fallbackId: proposalId,
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "no-store",
      },
    })
  } catch (error: unknown) {
    console.error("proposal export-pdf error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to export PDF" },
      { status: 500 }
    )
  }
}
