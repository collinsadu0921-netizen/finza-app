import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { signProposalAssetPaths } from "@/lib/proposals/signing"
import type { ProposalAssetRow } from "@/lib/proposals/assembleRenderModel"

export const dynamic = "force-dynamic"

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

    const { data: proposal } = await supabase
      .from("proposals")
      .select("id")
      .eq("id", proposalId)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .maybeSingle()

    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
    }

    const { data: assetsRaw } = await supabase
      .from("proposal_assets")
      .select("id, kind, mime_type, file_name, role, visible_on_public, internal_only, sort_order, storage_path")
      .eq("proposal_id", proposalId)
      .order("sort_order", { ascending: true })

    const assets = (assetsRaw || []) as ProposalAssetRow[]
    const signed = await signProposalAssetPaths(
      supabase,
      assets.map((a) => ({ id: a.id, storage_path: a.storage_path })),
      3600
    )

    return NextResponse.json({
      assets: assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        mime_type: a.mime_type,
        file_name: a.file_name,
        role: a.role,
        visible_on_public: a.visible_on_public,
        internal_only: a.internal_only,
        sort_order: a.sort_order,
        signed_url: signed[a.id] || null,
      })),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load assets"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
