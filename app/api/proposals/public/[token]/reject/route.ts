import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { logProposalAuditPublic } from "@/lib/proposals/proposalAudit"
import { normalizeProposalStatus, proposalTransitionPublicRejectIsValid } from "@/lib/proposals/proposalState"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const bodySchema = z
  .object({
    rejected_reason: z.string().max(2000).nullable().optional(),
  })
  .strict()

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

    const json = await request.json().catch(() => ({}))
    const body = bodySchema.safeParse(json)
    if (!body.success) {
      return NextResponse.json({ error: "Invalid body", details: body.error.flatten() }, { status: 400 })
    }

    const reasonRaw = body.data.rejected_reason
    const reason =
      reasonRaw === undefined || reasonRaw === null
        ? null
        : reasonRaw.trim().length === 0
          ? null
          : reasonRaw.trim().slice(0, 2000)

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
    if (!proposalTransitionPublicRejectIsValid(from)) {
      return NextResponse.json(
        { error: "This proposal cannot be rejected in its current state.", status: from },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()
    const { data: updated, error } = await admin
      .from("proposals")
      .update({
        status: "rejected",
        rejected_at: now,
        rejected_reason: reason,
        accepted_at: null,
      })
      .eq("id", before.id as string)
      .in("status", ["sent", "viewed"])
      .is("deleted_at", null)
      .select("id, business_id, status, rejected_at, rejected_reason")
      .maybeSingle()

    if (error || !updated) {
      return NextResponse.json(
        { error: "Could not reject proposal (it may have just changed). Please refresh." },
        { status: 409 }
      )
    }

    await logProposalAuditPublic({
      businessId: before.business_id as string,
      actionType: "proposal.rejected",
      entityId: before.id as string,
      newValues: { status: "rejected", rejected_at: now, rejected_reason: reason },
      request,
    })

    return NextResponse.json({
      ok: true,
      proposal: {
        id: updated.id,
        status: updated.status,
        rejected_at: updated.rejected_at,
        rejected_reason: updated.rejected_reason,
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Reject failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
