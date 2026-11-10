import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { detectProposalAssetMime } from "@/lib/proposals/assetValidation"
import {
  PROPOSAL_ASSET_ALLOWED_MIMES,
  PROPOSAL_ASSETS_BUCKET,
  isProposalAssetStoragePath,
  sanitizeProposalAssetDisplayName,
} from "@/lib/proposals/storageConstants"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Public proposal file proxy. Access requires a valid public token, a ready
 * asset, public visibility, and a storage path bound to the proposal's exact
 * business/proposal prefix. Service-role download is used only after those
 * checks; the object is never served from a client-supplied path.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; assetId: string }> | { token: string; assetId: string } }
) {
  try {
    const { token: rawToken, assetId } = await Promise.resolve(params)
    const token = (rawToken || "").trim()
    const id = (assetId || "").trim()
    if (!token || !id) {
      return NextResponse.json({ error: "Missing token or asset" }, { status: 400 })
    }

    const admin = getSupabaseServiceRoleClient()
    if (!admin) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
    }

    const { data: proposal, error: pErr } = await admin
      .from("proposals")
      .select("id, business_id, expires_at")
      .eq("public_token", token)
      .is("deleted_at", null)
      .maybeSingle()

    if (pErr || !proposal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const exp = proposal.expires_at as string | null
    if (exp && new Date(exp).getTime() < Date.now()) {
      return NextResponse.json({ error: "Expired" }, { status: 410 })
    }

    const { data: asset, error: aErr } = await admin
      .from("proposal_assets")
      .select(
        "id, proposal_id, business_id, storage_path, mime_type, file_name, visible_on_public, internal_only, upload_state"
      )
      .eq("id", id)
      .eq("proposal_id", proposal.id)
      .eq("business_id", proposal.business_id)
      .eq("upload_state", "ready")
      .maybeSingle()

    if (aErr || !asset) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    if (asset.internal_only || !asset.visible_on_public) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const path = (asset.storage_path as string | null)?.trim()
    if (!path || !isProposalAssetStoragePath(path, proposal.business_id, proposal.id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const declaredMime = String(asset.mime_type || "").trim().toLowerCase()
    if (!PROPOSAL_ASSET_ALLOWED_MIMES.has(declaredMime)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const { data: file, error: dErr } = await admin.storage.from(PROPOSAL_ASSETS_BUCKET).download(path)
    if (dErr || !file) {
      console.error("proposal public asset download:", dErr)
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const detectedMime = detectProposalAssetMime(buf)
    if (!detectedMime || detectedMime !== declaredMime) {
      console.error("proposal public asset MIME mismatch", { assetId: asset.id, declaredMime, detectedMime })
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const name =
      sanitizeProposalAssetDisplayName(asset.file_name as string | null)
        .replace(/[^\x20-\x7e]/g, "_")
        .replace(/"/g, "")
        .slice(0, 120) || "file"
    const isImage = detectedMime.startsWith("image/")
    const disposition = isImage ? "inline" : "attachment"

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": detectedMime,
        "Content-Disposition": `${disposition}; filename="${name}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    })
  } catch (e: unknown) {
    console.error("proposal public asset GET:", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
