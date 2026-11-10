import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { proposalAssetKindFromMime } from "@/lib/proposals/mime"
import { normalizeProposalStatus, proposalCanBeEditedByStaff } from "@/lib/proposals/proposalState"
import { cleanupExpiredProposalUploads } from "@/lib/proposals/uploadCleanup"
import {
  PROPOSAL_ASSETS_BUCKET,
  PROPOSAL_ASSET_MAX_BYTES,
  assertAllowedProposalMime,
  proposalAssetExtensionForMime,
  proposalAssetStoragePath,
  sanitizeProposalAssetDisplayName,
} from "@/lib/proposals/storageConstants"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_PENDING_PER_PROPOSAL = 20

const intentSchema = z
  .object({
    business_id: z.string().uuid(),
    file_name: z.string().min(1).max(255),
    mime_type: z.string().min(1).max(120),
    file_size: z.number().int().positive().max(PROPOSAL_ASSET_MAX_BYTES),
    role: z.enum(["inline", "attachment", "gallery"]).optional(),
  })
  .strict()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: proposalId } = await Promise.resolve(params)
    if (!proposalId) {
      return NextResponse.json({ error: "Proposal id required" }, { status: 400 })
    }

    const body = intentSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: "Invalid upload request" }, { status: 400 })
    }

    const mime = body.data.mime_type.trim().toLowerCase()
    try {
      assertAllowedProposalMime(mime)
    } catch {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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

    const admin = getSupabaseServiceRoleClient()
    if (!admin) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
    }

    // Lazy cleanup keeps abandoned uploads from accumulating without a
    // mandatory crontab dependency. The global cleanup route uses the same
    // helper for periodic maintenance.
    await cleanupExpiredProposalUploads({ businessId, proposalId, olderThanMinutes: 120 })

    const { count: pendingCount } = await admin
      .from("proposal_assets")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("proposal_id", proposalId)
      .eq("upload_state", "pending")

    if ((pendingCount ?? 0) >= MAX_PENDING_PER_PROPOSAL) {
      return NextResponse.json(
        { error: "Too many unfinished uploads. Please retry in a few minutes." },
        { status: 429 }
      )
    }

    const assetId = randomUUID()
    const extension = proposalAssetExtensionForMime(mime)
    const storagePath = proposalAssetStoragePath(businessId, proposalId, assetId, extension)
    const kind = proposalAssetKindFromMime(mime)
    const role = body.data.role ?? (kind === "pdf" ? "attachment" : "inline")
    const displayName = sanitizeProposalAssetDisplayName(body.data.file_name)

    const { error: insertError } = await admin.from("proposal_assets").insert({
      id: assetId,
      proposal_id: proposalId,
      business_id: businessId,
      kind,
      mime_type: mime,
      file_name: displayName,
      file_size: body.data.file_size,
      storage_path: storagePath,
      role,
      visible_on_public: true,
      internal_only: false,
      sort_order: 0,
      metadata: {},
      upload_state: "pending",
    })

    if (insertError) {
      console.error("proposal upload intent insert:", insertError)
      return NextResponse.json({ error: "Failed to prepare upload" }, { status: 500 })
    }

    const { data: signed, error: signError } = await admin.storage
      .from(PROPOSAL_ASSETS_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false })

    if (signError || !signed?.token) {
      console.error("proposal upload intent sign:", signError)
      await admin.from("proposal_assets").delete().eq("id", assetId).eq("upload_state", "pending")
      return NextResponse.json({ error: "Failed to prepare upload" }, { status: 500 })
    }

    await createAuditLog({
      businessId,
      userId: user.id,
      actionType: "proposal_asset_upload_intent",
      entityType: "proposal_asset",
      entityId: assetId,
      newValues: { proposal_id: proposalId, mime_type: mime, file_name: displayName },
      request,
    })

    return NextResponse.json({
      asset_id: assetId,
      path: storagePath,
      token: signed.token,
      signed_url: signed.signedUrl,
      expires_in: 7200,
      max_bytes: PROPOSAL_ASSET_MAX_BYTES,
    })
  } catch (error: unknown) {
    console.error("proposal upload intent error:", error)
    return NextResponse.json({ error: "Failed to prepare upload" }, { status: 500 })
  }
}
