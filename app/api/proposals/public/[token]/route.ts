import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { assembleProposalRenderModel, type ProposalAssetRow, type ProposalRow } from "@/lib/proposals/assembleRenderModel"
import type { ProposalRenderBusiness, ProposalRenderCustomer } from "@/lib/proposals/renderModel"
import {
  normalizeProposalStatus,
  proposalPublicActionsAllowed,
  type ProposalStatus,
} from "@/lib/proposals/proposalState"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type ProposalDbRow = ProposalRow & {
  id: string
  business_id: string
  customer_id: string | null
  expires_at: string | null
  viewed_at: string | null
  sent_at: string | null
  accepted_at?: string | null
  rejected_at?: string | null
  rejected_reason?: string | null
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> | { token: string } }
) {
  try {
    const { token: raw } = await Promise.resolve(params)
    const token = (raw || "").trim()
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 })
    }

    const admin = getSupabaseServiceRoleClient()
    if (!admin) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
    }

    const { data: proposal, error: pErr } = await admin
      .from("proposals")
      .select(
        "id, business_id, customer_id, title, proposal_number, status, template_id, sections, pricing_mode, pricing_payload, currency_code, public_token, expires_at, viewed_at, sent_at, accepted_at, rejected_at, rejected_reason, created_at"
      )
      .eq("public_token", token)
      .is("deleted_at", null)
      .maybeSingle()

    if (pErr || !proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
    }

    const p = proposal as ProposalDbRow

    if (p.expires_at && new Date(p.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Proposal has expired" }, { status: 410 })
    }

    // Idempotent first view: only rows still in `sent` with no viewed_at transition to `viewed`.
    await admin
      .from("proposals")
      .update({ status: "viewed", viewed_at: new Date().toISOString() })
      .eq("id", p.id)
      .eq("status", "sent")
      .is("viewed_at", null)

    const { data: fresh } = await admin
      .from("proposals")
      .select(
        "status, viewed_at, sent_at, accepted_at, rejected_at, rejected_reason, title, proposal_number, template_id, sections, pricing_mode, pricing_payload, currency_code, public_token"
      )
      .eq("id", p.id)
      .single()

    const merged: ProposalDbRow = {
      ...p,
      ...(fresh || {}),
    } as ProposalDbRow

    const businessId = merged.business_id

    const { data: business } = await admin
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

    let customer: ProposalRenderCustomer | null = null
    if (merged.customer_id) {
      const { data: cust } = await admin
        .from("customers")
        .select("name, email, phone")
        .eq("id", merged.customer_id)
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .maybeSingle()
      if (cust) {
        customer = { name: cust.name as string, email: cust.email ?? null, phone: cust.phone ?? null }
      }
    }

    const { data: assetsRaw } = await admin
      .from("proposal_assets")
      .select("id, kind, mime_type, file_name, role, visible_on_public, internal_only, sort_order, storage_path")
      .eq("proposal_id", merged.id)
      .order("sort_order", { ascending: true })

    const assets = (assetsRaw || []) as ProposalAssetRow[]

    const tokenSeg = encodeURIComponent(token.trim())
    const { model } = await assembleProposalRenderModel(admin, {
      proposal: merged as ProposalRow,
      business: b,
      customer,
      assets,
      publicView: true,
      signTtlSec: 7200,
      includePublicToken: false,
      publicAssetUrlForId: (assetId) =>
        `/api/proposals/public/${tokenSeg}/assets/${encodeURIComponent(assetId)}`,
    })

    const st = normalizeProposalStatus(merged.status as string) as ProposalStatus
    const actionable = proposalPublicActionsAllowed(st)

    return NextResponse.json({
      render: model,
      meta: {
        title: merged.title,
        status: merged.status,
        proposal_number: merged.proposal_number,
        business_name: b.name,
        viewed_at: merged.viewed_at,
        sent_at: merged.sent_at,
        accepted_at: merged.accepted_at ?? null,
        rejected_at: merged.rejected_at ?? null,
        rejected_reason: merged.rejected_reason ?? null,
        actionable,
        can_accept: actionable,
        can_reject: actionable,
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load proposal"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
