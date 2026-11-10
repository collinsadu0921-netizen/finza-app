import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { normalizeProposalStatus, proposalCanBeEditedByStaff } from "@/lib/proposals/proposalState"
import {
  ProposalAssetValidationError,
  validateProposalAssetContent,
} from "@/lib/proposals/assetValidation"
import {
  PROPOSAL_ASSETS_BUCKET,
  isProposalAssetStoragePath,
} from "@/lib/proposals/storageConstants"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

const PENDING_TTL_MS = 2 * 60 * 60 * 1000

const finalizeSchema = z
  .object({
    business_id: z.string().uuid(),
    asset_id: z.string().uuid(),
    path: z.string().min(1).max(600),
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

    const body = finalizeSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: "Invalid upload finalization" }, { status: 400 })
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

    const { data: pending } = await admin
      .from("proposal_assets")
      .select(
        "id, proposal_id, business_id, kind, mime_type, file_name, storage_path, role, upload_state, created_at"
      )
      .eq("id", body.data.asset_id)
      .eq("proposal_id", proposalId)
      .eq("business_id", businessId)
      .eq("upload_state", "pending")
      .maybeSingle()

    if (!pending) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 })
    }

    if (
      !isProposalAssetStoragePath(pending.storage_path, businessId, proposalId) ||
      pending.storage_path !== body.data.path
    ) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 })
    }

    if (pending.created_at && Date.now() - new Date(pending.created_at).getTime() > PENDING_TTL_MS) {
      await admin.storage.from(PROPOSAL_ASSETS_BUCKET).remove([pending.storage_path])
      await admin.from("proposal_assets").delete().eq("id", pending.id).eq("upload_state", "pending")
      return NextResponse.json({ error: "Upload authorisation has expired" }, { status: 410 })
    }

    const { data: file, error: downloadError } = await admin.storage
      .from(PROPOSAL_ASSETS_BUCKET)
      .download(pending.storage_path)

    if (downloadError || !file) {
      await admin.from("proposal_assets").delete().eq("id", pending.id).eq("upload_state", "pending")
      return NextResponse.json({ error: "Uploaded file not found" }, { status: 400 })
    }

    let validated
    try {
      validated = await validateProposalAssetContent({
        buffer: Buffer.from(await file.arrayBuffer()),
        declaredMime: pending.mime_type,
      })
    } catch (error: unknown) {
      await admin.storage.from(PROPOSAL_ASSETS_BUCKET).remove([pending.storage_path])
      await admin.from("proposal_assets").delete().eq("id", pending.id).eq("upload_state", "pending")
      if (error instanceof ProposalAssetValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      console.error("proposal upload finalize validation:", error)
      return NextResponse.json({ error: "Uploaded file could not be validated" }, { status: 400 })
    }

    if (validated.rewritten) {
      const { error: reuploadError } = await admin.storage
        .from(PROPOSAL_ASSETS_BUCKET)
        .upload(pending.storage_path, validated.buffer, {
          contentType: validated.mimeType,
          upsert: true,
        })
      if (reuploadError) {
        console.error("proposal upload finalize sanitize:", reuploadError)
        return NextResponse.json({ error: "Uploaded file could not be finalized" }, { status: 500 })
      }
    }

    const { data: updated, error: updateError } = await admin
      .from("proposal_assets")
      .update({
        upload_state: "ready",
        mime_type: validated.mimeType,
        file_size: validated.size,
        metadata:
          validated.width && validated.height
            ? { width: validated.width, height: validated.height }
            : {},
      })
      .eq("id", pending.id)
      .eq("upload_state", "pending")
      .select("id, kind, mime_type, file_name, role, visible_on_public, internal_only, sort_order, metadata")
      .maybeSingle()

    if (updateError || !updated) {
      console.error("proposal upload finalize update:", updateError)
      await admin.storage.from(PROPOSAL_ASSETS_BUCKET).remove([pending.storage_path])
      await admin.from("proposal_assets").delete().eq("id", pending.id).eq("upload_state", "pending")
      return NextResponse.json({ error: "Uploaded file could not be finalized" }, { status: 500 })
    }

    await createAuditLog({
      businessId,
      userId: user.id,
      actionType: "proposal_asset_uploaded",
      entityType: "proposal_asset",
      entityId: pending.id,
      newValues: {
        proposal_id: proposalId,
        mime_type: validated.mimeType,
        file_name: pending.file_name,
      },
      request,
    })

    return NextResponse.json({ asset: updated })
  } catch (error: unknown) {
    console.error("proposal upload finalize error:", error)
    return NextResponse.json({ error: "Failed to finalize upload" }, { status: 500 })
  }
}
