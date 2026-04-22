import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { PROPOSAL_ASSETS_BUCKET } from "@/lib/proposals/storageConstants"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Public proposal file — same-origin proxy so inline images and attachment links work
 * on /proposal-public/* without depending on cross-origin Supabase signed URLs.
 * Access: valid public_token + asset visible_on_public + not internal_only.
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
      .select("id, expires_at")
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
      .select("id, proposal_id, storage_path, mime_type, file_name, visible_on_public, internal_only")
      .eq("id", id)
      .eq("proposal_id", proposal.id)
      .maybeSingle()

    if (aErr || !asset) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    if (asset.internal_only || !asset.visible_on_public) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const path = (asset.storage_path as string | null)?.trim()
    if (!path || path === "__placeholder__") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const { data: file, error: dErr } = await admin.storage.from(PROPOSAL_ASSETS_BUCKET).download(path)
    if (dErr || !file) {
      console.error("proposal public asset download:", dErr)
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const mime = (asset.mime_type as string)?.trim() || "application/octet-stream"
    const name = (asset.file_name as string)?.trim() || "file"
    const asciiName = name.replace(/[^\x20-\x7e]/g, "_").slice(0, 120) || "file"

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="${asciiName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (e: unknown) {
    console.error("proposal public asset GET:", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
