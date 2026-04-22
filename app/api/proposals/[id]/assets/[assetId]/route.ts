import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { PROPOSAL_ASSETS_BUCKET } from "@/lib/proposals/storageConstants"
import { normalizeProposalStatus, proposalCanBeEditedByStaff } from "@/lib/proposals/proposalState"

export const dynamic = "force-dynamic"

const patchSchema = z
  .object({
    business_id: z.string().uuid(),
    visible_on_public: z.boolean().optional(),
    internal_only: z.boolean().optional(),
    role: z.enum(["inline", "attachment", "gallery"]).optional(),
    sort_order: z.number().int().optional(),
    section_ref: z.string().max(200).nullable().optional(),
  })
  .strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> | { id: string; assetId: string } }
) {
  try {
    const { id: proposalId, assetId } = await Promise.resolve(params)
    if (!proposalId || !assetId) {
      return NextResponse.json({ error: "proposal id and asset id required" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const json = await request.json().catch(() => null)
    const body = patchSchema.safeParse(json)
    if (!body.success) {
      return NextResponse.json({ error: "Invalid body", details: body.error.flatten() }, { status: 400 })
    }

    const scope = await resolveBusinessScopeForUser(supabase, user.id, body.data.business_id)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const businessId = scope.businessId

    const { data: proposal } = await supabase
      .from("proposals")
      .select("id, status")
      .eq("id", proposalId)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .maybeSingle()

    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
    }
    if (!proposalCanBeEditedByStaff(normalizeProposalStatus(proposal.status as string))) {
      return NextResponse.json({ error: "Proposal is locked" }, { status: 403 })
    }

    const patch: Record<string, unknown> = {}
    if (body.data.visible_on_public !== undefined) patch.visible_on_public = body.data.visible_on_public
    if (body.data.internal_only !== undefined) patch.internal_only = body.data.internal_only
    if (body.data.role !== undefined) patch.role = body.data.role
    if (body.data.sort_order !== undefined) patch.sort_order = body.data.sort_order
    if (body.data.section_ref !== undefined) patch.section_ref = body.data.section_ref

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No changes" }, { status: 400 })
    }

    const { data: row, error } = await supabase
      .from("proposal_assets")
      .update(patch)
      .eq("id", assetId)
      .eq("proposal_id", proposalId)
      .eq("business_id", businessId)
      .select("id, kind, mime_type, file_name, role, visible_on_public, internal_only, sort_order, section_ref")
      .maybeSingle()

    if (error || !row) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 })
    }

    await createAuditLog({
      businessId,
      userId: user.id,
      actionType: "proposal_asset_updated",
      entityType: "proposal_asset",
      entityId: assetId,
      newValues: patch,
      request,
    })

    return NextResponse.json({ asset: row })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Update failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> | { id: string; assetId: string } }
) {
  try {
    const { id: proposalId, assetId } = await Promise.resolve(params)
    if (!proposalId || !assetId) {
      return NextResponse.json({ error: "proposal id and asset id required" }, { status: 400 })
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

    const { data: proposal } = await supabase
      .from("proposals")
      .select("id, status")
      .eq("id", proposalId)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .maybeSingle()

    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
    }
    if (!proposalCanBeEditedByStaff(normalizeProposalStatus(proposal.status as string))) {
      return NextResponse.json({ error: "Proposal is locked" }, { status: 403 })
    }

    const { data: asset } = await supabase
      .from("proposal_assets")
      .select("id, storage_path")
      .eq("id", assetId)
      .eq("proposal_id", proposalId)
      .eq("business_id", businessId)
      .maybeSingle()

    if (!asset?.storage_path) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 })
    }

    const { error: delDb } = await supabase.from("proposal_assets").delete().eq("id", assetId)
    if (delDb) {
      return NextResponse.json({ error: delDb.message }, { status: 500 })
    }

    if (asset.storage_path && !asset.storage_path.startsWith("__")) {
      await supabase.storage.from(PROPOSAL_ASSETS_BUCKET).remove([asset.storage_path])
    }

    await createAuditLog({
      businessId,
      userId: user.id,
      actionType: "proposal_asset_deleted",
      entityType: "proposal_asset",
      entityId: assetId,
      request,
    })

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Delete failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
