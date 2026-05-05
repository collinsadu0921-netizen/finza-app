import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { assembleProposalRenderModel, type ProposalAssetRow, type ProposalRow } from "@/lib/proposals/assembleRenderModel"
import type { ProposalRenderBusiness, ProposalRenderCustomer } from "@/lib/proposals/renderModel"
import { buildProposalHtmlForPdf } from "@/lib/proposals/buildProposalHtmlForPdf"
import { renderHtmlToPdfBuffer } from "@/lib/pdf/renderHtmlToPdf"
import { buildFinancialDocumentPdfDisposition } from "@/lib/documents/financialDocumentPdfDisposition"
import { normalizeProposalStatus } from "@/lib/proposals/proposalState"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

type ProposalDbRow = ProposalRow & {
  id: string
  business_id: string
  customer_id: string | null
  expires_at: string | null
  title?: string | null
  proposal_number?: string | null
  status?: string | null
}
const PUBLIC_PROPOSAL_PDF_STATUSES = new Set(["sent", "viewed", "accepted", "rejected", "converted"])

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> | { token: string } }
) {
  try {
    const { token: raw } = await Promise.resolve(params)
    const token = (raw || "").trim()
    if (!token) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const admin = getSupabaseServiceRoleClient()
    if (!admin) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
    }

    const { data: proposal, error: pErr } = await admin
      .from("proposals")
      .select(
        "id, business_id, customer_id, title, proposal_number, status, template_id, sections, pricing_mode, pricing_payload, currency_code, public_token, expires_at"
      )
      .eq("public_token", token)
      .is("deleted_at", null)
      .maybeSingle()

    if (pErr || !proposal) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const p = proposal as ProposalDbRow
    const status = normalizeProposalStatus(p.status)
    if (!PUBLIC_PROPOSAL_PDF_STATUSES.has(status)) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }
    if (p.expires_at && new Date(p.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const { data: business } = await admin
      .from("businesses")
      .select("name, legal_name, trading_name, logo_url, email, phone, address, default_currency")
      .eq("id", p.business_id)
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

    let customer: ProposalRenderCustomer | null = null
    if (p.customer_id) {
      const { data: cust } = await admin
        .from("customers")
        .select("name, email, phone")
        .eq("id", p.customer_id)
        .eq("business_id", p.business_id)
        .is("deleted_at", null)
        .maybeSingle()
      if (cust) {
        customer = { name: cust.name as string, email: cust.email ?? null, phone: cust.phone ?? null }
      }
    }

    const { data: assetsRaw } = await admin
      .from("proposal_assets")
      .select("id, kind, mime_type, file_name, role, visible_on_public, internal_only, sort_order, storage_path")
      .eq("proposal_id", p.id)
      .order("sort_order", { ascending: true })

    const assets = (assetsRaw || []) as ProposalAssetRow[]
    const tokenSeg = encodeURIComponent(token)
    const { model } = await assembleProposalRenderModel(admin, {
      proposal: p as ProposalRow,
      business: b,
      customer,
      assets,
      publicView: true,
      signTtlSec: 7200,
      includePublicToken: false,
      publicAssetUrlForId: (assetId) =>
        `/api/proposals/public/${tokenSeg}/assets/${encodeURIComponent(assetId)}`,
    })

    const html = buildProposalHtmlForPdf(model)
    const pdfBuffer = await renderHtmlToPdfBuffer(html)
    const { contentDisposition } = buildFinancialDocumentPdfDisposition({
      label: "Proposal",
      documentNumber: p.proposal_number || p.title || null,
      fallbackId: p.id,
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "no-store",
      },
    })
  } catch (e: unknown) {
    console.error("public proposal pdf error:", e)
    return NextResponse.json({ error: "Failed to export PDF" }, { status: 500 })
  }
}
