import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { logProposalAuditPublic } from "@/lib/proposals/proposalAudit"
import { normalizeProposalStatus, proposalTransitionPublicAcceptIsValid } from "@/lib/proposals/proposalState"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(
  request: NextRequest,
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

    const { data: before } = await admin
      .from("proposals")
      .select("id, business_id, status, expires_at")
      .eq("public_token", token)
      .is("deleted_at", null)
      .maybeSingle()

    if (!before) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
    }

    if (before.expires_at && new Date(before.expires_at as string).getTime() < Date.now()) {
      return NextResponse.json({ error: "Proposal has expired" }, { status: 410 })
    }

    const from = normalizeProposalStatus(before.status as string)
    if (!proposalTransitionPublicAcceptIsValid(from)) {
      return NextResponse.json(
        { error: "This proposal cannot be accepted in its current state.", status: from },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()
    const { data: updated, error } = await admin
      .from("proposals")
      .update({
        status: "accepted",
        accepted_at: now,
        rejected_at: null,
        rejected_reason: null,
      })
      .eq("id", before.id as string)
      .in("status", ["sent", "viewed"])
      .is("deleted_at", null)
      .select("id, business_id, status, accepted_at")
      .maybeSingle()

    if (error || !updated) {
      return NextResponse.json(
        { error: "Could not accept proposal (it may have just changed). Please refresh." },
        { status: 409 }
      )
    }

    await logProposalAuditPublic({
      businessId: before.business_id as string,
      actionType: "proposal.accepted",
      entityId: before.id as string,
      newValues: { status: "accepted", accepted_at: now },
      request,
    })

    return NextResponse.json({
      ok: true,
      proposal: { id: updated.id, status: updated.status, accepted_at: updated.accepted_at },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Accept failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
