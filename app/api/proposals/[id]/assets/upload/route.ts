import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import {
  assertAllowedProposalMime,
  PROPOSAL_ASSET_MAX_BYTES,
  proposalAssetStoragePath,
  PROPOSAL_ASSETS_BUCKET,
} from "@/lib/proposals/storageConstants"
import { proposalAssetKindFromMime } from "@/lib/proposals/mime"
import { normalizeProposalStatus, proposalCanBeEditedByStaff } from "@/lib/proposals/proposalState"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(
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

    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 })
    }

    const mime = (file as File).type || "application/octet-stream"
    assertAllowedProposalMime(mime)

    const size = typeof file.size === "number" ? file.size : 0
    if (size <= 0 || size > PROPOSAL_ASSET_MAX_BYTES) {
      return NextResponse.json({ error: `File must be between 1 byte and ${PROPOSAL_ASSET_MAX_BYTES} bytes` }, { status: 400 })
    }

    const roleRaw = (form.get("role") as string | null)?.trim().toLowerCase()
    const kind = proposalAssetKindFromMime(mime)
    const defaultRole = kind === "pdf" ? "attachment" : "inline"
    const role = roleRaw === "attachment" || roleRaw === "inline" || roleRaw === "gallery" ? roleRaw : defaultRole

    const originalName = typeof (file as File).name === "string" && (file as File).name ? (file as File).name : "upload"

    const { data: inserted, error: insErr } = await supabase
      .from("proposal_assets")
      .insert({
        proposal_id: proposalId,
        business_id: businessId,
        kind,
        mime_type: mime,
        file_name: originalName.slice(0, 240),
        file_size: size,
        storage_path: "__placeholder__",
        role,
        visible_on_public: true,
        internal_only: false,
        sort_order: 0,
      })
      .select("id")
      .single()

    if (insErr || !inserted?.id) {
      console.error("proposal_assets insert:", insErr)
      return NextResponse.json({ error: insErr?.message || "Failed to create asset row" }, { status: 500 })
    }

    const assetId = inserted.id as string
    const storagePath = proposalAssetStoragePath(businessId, proposalId, assetId, originalName)

    const { error: pathUp } = await supabase.from("proposal_assets").update({ storage_path: storagePath }).eq("id", assetId)
    if (pathUp) {
      await supabase.from("proposal_assets").delete().eq("id", assetId)
      return NextResponse.json({ error: "Failed to prepare asset path" }, { status: 500 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await supabase.storage.from(PROPOSAL_ASSETS_BUCKET).upload(storagePath, buf, {
      contentType: mime,
      upsert: false,
    })

    if (upErr) {
      await supabase.from("proposal_assets").delete().eq("id", assetId)
      console.error("proposal asset upload:", upErr)
      return NextResponse.json({ error: upErr.message || "Upload failed" }, { status: 500 })
    }

    const { data: row } = await supabase
      .from("proposal_assets")
      .select("id, kind, mime_type, file_name, role, visible_on_public, internal_only, sort_order")
      .eq("id", assetId)
      .single()

    await createAuditLog({
      businessId,
      userId: user.id,
      actionType: "proposal_asset_uploaded",
      entityType: "proposal_asset",
      entityId: assetId,
      newValues: { proposal_id: proposalId, mime_type: mime, file_name: originalName },
      request,
    })

    return NextResponse.json({ asset: row })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Upload failed"
    const status = msg.includes("Unsupported file") ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
