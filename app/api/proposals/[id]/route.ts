import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { assertProposalSections } from "@/lib/proposals/schema"
import { validateAndNormalizePricingForDb } from "@/lib/proposals/pricingForDb"
import { assembleProposalRenderModel, type ProposalAssetRow, type ProposalRow } from "@/lib/proposals/assembleRenderModel"
import type { ProposalRenderBusiness, ProposalRenderCustomer } from "@/lib/proposals/renderModel"
import { isKnownTemplateId, DEFAULT_PROPOSAL_TEMPLATE_ID } from "@/lib/proposals/templates"
import { normalizeProposalStatus, proposalCanBeEditedByStaff } from "@/lib/proposals/proposalState"

export const dynamic = "force-dynamic"

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

  if (!customerId) {
    return { business: b, customer: null }
  }
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
        "id, business_id, customer_id, title, proposal_number, status, template_id, sections, pricing_mode, pricing_payload, currency_code, public_token, expires_at, sent_at, viewed_at, accepted_at, rejected_at, rejected_reason, converted_estimate_id, converted_at, created_at, updated_at"
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

    const { business, customer } = await loadBusinessCustomer(supabase, businessId, proposal.customer_id as string | null)

    const { model, assetUrlById } = await assembleProposalRenderModel(supabase, {
      proposal: proposal as ProposalRow,
      business,
      customer,
      assets,
      publicView: false,
      signTtlSec: 3600,
      includePublicToken: true,
    })

    const assetsOut = assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      mime_type: a.mime_type,
      file_name: a.file_name,
      role: a.role,
      visible_on_public: a.visible_on_public,
      internal_only: a.internal_only,
      sort_order: a.sort_order,
      signed_url: assetUrlById[a.id] || null,
    }))

    return NextResponse.json({
      proposal,
      assets: assetsOut,
      render: model,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load proposal"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

const putSchema = z
  .object({
    business_id: z.string().uuid(),
    title: z.string().max(500).optional(),
    customer_id: z.string().uuid().nullable().optional(),
    sections: z.array(z.unknown()).optional(),
    template_id: z.string().max(120).optional(),
    pricing_mode: z.enum(["none", "fixed", "line_items", "custom"]).optional(),
    pricing_payload: z.unknown().optional(),
    currency_code: z.string().max(8).nullable().optional(),
  })
  .strict()

export async function PUT(
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

    const json = await request.json().catch(() => null)
    const body = putSchema.safeParse(json)
    if (!body.success) {
      return NextResponse.json({ error: "Invalid body", details: body.error.flatten() }, { status: 400 })
    }

    const scope = await resolveBusinessScopeForUser(supabase, user.id, body.data.business_id)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const businessId = scope.businessId

    const { data: existing, error: exErr } = await supabase
      .from("proposals")
      .select("id, status, title, customer_id, template_id, sections, pricing_mode, pricing_payload, currency_code")
      .eq("id", proposalId)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .maybeSingle()

    if (exErr || !existing) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
    }

    const currentStatus = normalizeProposalStatus(existing.status as string)
    const locked = !proposalCanBeEditedByStaff(currentStatus)

    if (locked) {
      if (body.data.title === undefined) {
        return NextResponse.json(
          { error: "Proposal is locked (accepted, rejected, converted, or expired). Only the title can be changed." },
          { status: 403 }
        )
      }
      const patchLocked: Record<string, unknown> = {
        updated_by_user_id: user.id,
        title: body.data.title.trim(),
      }
      const { data: rowLocked, error: errLocked } = await supabase
        .from("proposals")
        .update(patchLocked)
        .eq("id", proposalId)
        .eq("business_id", businessId)
        .select("id, title, status, template_id, customer_id, sections, pricing_mode, pricing_payload, currency_code, updated_at")
        .single()

      if (errLocked || !rowLocked) {
        console.error("proposal put (title-only):", errLocked)
        return NextResponse.json({ error: errLocked?.message || "Update failed" }, { status: 500 })
      }

      await createAuditLog({
        businessId,
        userId: user.id,
        actionType: "proposal_title_updated",
        entityType: "proposal",
        entityId: proposalId,
        oldValues: { title: existing.title },
        newValues: patchLocked,
        request,
      })

      return NextResponse.json({ proposal: rowLocked })
    }

    if (body.data.customer_id !== undefined && body.data.customer_id !== null) {
      const { data: cust } = await supabase
        .from("customers")
        .select("id")
        .eq("id", body.data.customer_id)
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .maybeSingle()
      if (!cust) {
        return NextResponse.json({ error: "Customer not found for this business" }, { status: 400 })
      }
    }

    const patch: Record<string, unknown> = {
      updated_by_user_id: user.id,
    }

    if (body.data.title !== undefined) patch.title = body.data.title.trim()
    if (body.data.customer_id !== undefined) patch.customer_id = body.data.customer_id
    if (body.data.sections !== undefined) {
      patch.sections = assertProposalSections(body.data.sections)
    }
    if (body.data.template_id !== undefined) {
      patch.template_id = isKnownTemplateId(body.data.template_id) ? body.data.template_id : DEFAULT_PROPOSAL_TEMPLATE_ID
    }
    if (body.data.currency_code !== undefined) {
      patch.currency_code = body.data.currency_code?.trim() || null
    }

    if (body.data.pricing_mode !== undefined) {
      const normalized = validateAndNormalizePricingForDb(body.data.pricing_mode, body.data.pricing_payload ?? {})
      patch.pricing_mode = normalized.pricing_mode
      patch.pricing_payload = normalized.pricing_payload
    } else if (body.data.pricing_payload !== undefined) {
      const normalized = validateAndNormalizePricingForDb(
        (existing.pricing_mode as string) || "none",
        body.data.pricing_payload
      )
      patch.pricing_mode = normalized.pricing_mode
      patch.pricing_payload = normalized.pricing_payload
    }

    const { data: row, error } = await supabase
      .from("proposals")
      .update(patch)
      .eq("id", proposalId)
      .eq("business_id", businessId)
      .select("id, title, status, template_id, customer_id, sections, pricing_mode, pricing_payload, currency_code, updated_at")
      .single()

    if (error || !row) {
      console.error("proposal put:", error)
      return NextResponse.json({ error: error?.message || "Update failed" }, { status: 500 })
    }

    await createAuditLog({
      businessId,
      userId: user.id,
      actionType: "proposal_updated",
      entityType: "proposal",
      entityId: proposalId,
      oldValues: {
        title: existing.title,
        status: existing.status,
      },
      newValues: patch,
      request,
    })

    return NextResponse.json({ proposal: row })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to update proposal"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

/**
 * Soft-delete a proposal (sets `deleted_at`). Same editability rules as content updates.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: proposalId } = await Promise.resolve(params)
    if (!proposalId) {
      return NextResponse.json({ error: "Proposal id required" }, { status: 400 })
    }

    const businessId = request.nextUrl.searchParams.get("business_id")
    if (!businessId) {
      return NextResponse.json({ error: "business_id query parameter required" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = await resolveBusinessScopeForUser(supabase, user.id, businessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const { data: existing, error: exErr } = await supabase
      .from("proposals")
      .select("id, status, title")
      .eq("id", proposalId)
      .eq("business_id", scope.businessId)
      .is("deleted_at", null)
      .maybeSingle()

    if (exErr || !existing) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
    }

    const currentStatus = normalizeProposalStatus(existing.status as string)
    if (!proposalCanBeEditedByStaff(currentStatus)) {
      return NextResponse.json(
        { error: "Proposal cannot be deleted in its current state (e.g. accepted or converted)." },
        { status: 403 }
      )
    }

    const now = new Date().toISOString()
    const { error: delErr } = await supabase
      .from("proposals")
      .update({ deleted_at: now, updated_by_user_id: user.id })
      .eq("id", proposalId)
      .eq("business_id", scope.businessId)
      .is("deleted_at", null)

    if (delErr) {
      console.error("proposal delete:", delErr)
      return NextResponse.json({ error: delErr.message || "Delete failed" }, { status: 500 })
    }

    await createAuditLog({
      businessId: scope.businessId,
      userId: user.id,
      actionType: "proposal_deleted",
      entityType: "proposal",
      entityId: proposalId,
      oldValues: { title: existing.title, status: existing.status },
      newValues: { deleted_at: now },
      request,
    })

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to delete proposal"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
