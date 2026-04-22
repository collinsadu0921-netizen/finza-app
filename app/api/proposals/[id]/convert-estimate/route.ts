import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { createDraftEstimateForBusiness } from "@/lib/estimates/createDraftEstimateForBusiness"
import { buildEstimateItemsFromProposal } from "@/lib/proposals/buildEstimateItemsFromProposal"
import {
  normalizeProposalStatus,
  proposalConversionBlockReason,
  proposalIsLinkedToEstimate,
  type ProposalStatus,
} from "@/lib/proposals/proposalState"

export const dynamic = "force-dynamic"

const bodySchema = z
  .object({
    business_id: z.string().uuid(),
  })
  .strict()

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().split("T")[0]
}

function wrongStatusMessage(status: ProposalStatus): string {
  switch (status) {
    case "draft":
      return "This proposal is still a draft. Send it to the client and wait for acceptance before converting."
    case "sent":
    case "viewed":
      return "The proposal must be accepted by the client before it can be converted to an estimate."
    case "rejected":
      return "Rejected proposals cannot be converted to an estimate."
    case "expired":
      return "Expired proposals cannot be converted to an estimate."
    case "converted":
      return "This proposal has already been converted to an estimate."
    case "accepted":
      return "This proposal cannot be converted in its current state."
    default:
      return "This proposal cannot be converted in its current state."
  }
}

/**
 * POST /api/proposals/[id]/convert-estimate
 * Accepted proposals only → new draft estimate; proposal marked converted and linked.
 */
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

    const json = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 })
    }

    const scope = await resolveBusinessScopeForUser(supabase, user.id, parsed.data.business_id)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const businessId = scope.businessId

    const { data: proposal, error: loadErr } = await supabase
      .from("proposals")
      .select(
        "id, business_id, customer_id, title, proposal_number, status, pricing_mode, pricing_payload, currency_code, expires_at, converted_estimate_id, converted_at, deleted_at"
      )
      .eq("id", proposalId)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .maybeSingle()

    if (loadErr || !proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
    }

    const st = normalizeProposalStatus(proposal.status as string)

    if (st === "converted" || proposalIsLinkedToEstimate(proposal.converted_estimate_id as string | null)) {
      return NextResponse.json(
        {
          error: "This proposal has already been converted to an estimate.",
          converted_estimate_id: (proposal.converted_estimate_id as string) || null,
          converted_at: proposal.converted_at ?? null,
        },
        { status: 409 }
      )
    }

    const block = proposalConversionBlockReason({
      status: st,
      converted_estimate_id: proposal.converted_estimate_id as string | null,
      pricing_mode: proposal.pricing_mode as string,
    })

    if (block === "wrong_status") {
      return NextResponse.json({ error: wrongStatusMessage(st), status: st }, { status: 400 })
    }

    const itemsBuild = buildEstimateItemsFromProposal({
      title: (proposal.title as string) || "",
      pricing_mode: (proposal.pricing_mode as string) || "none",
      pricing_payload: proposal.pricing_payload,
    })
    if (!itemsBuild.ok) {
      return NextResponse.json({ error: itemsBuild.error }, { status: itemsBuild.status })
    }

    const refLabel = ((proposal.proposal_number as string) || "").trim() || (proposal.id as string)
    const titleLine = ((proposal.title as string) || "").trim()
    const notesLines = [`Derived from proposal ${refLabel}`, titleLine ? titleLine : null].filter(Boolean) as string[]
    const notes = notesLines.join("\n\n")

    const issueDate = new Date().toISOString().split("T")[0]
    const expiryDate = toDateOnly(proposal.expires_at as string | null)

    const createRes = await createDraftEstimateForBusiness({
      supabase,
      userId: user.id,
      businessId,
      request,
      input: {
        customer_id: (proposal.customer_id as string) || null,
        issue_date: issueDate,
        expiry_date: expiryDate,
        notes,
        items: itemsBuild.items,
        apply_taxes: true,
        currency_code: (proposal.currency_code as string)?.trim() || null,
        fx_rate: null,
      },
    })

    if (!createRes.ok) {
      return NextResponse.json(
        {
          success: false,
          error: createRes.error,
          message: createRes.message ?? createRes.error,
          details: createRes.details,
        },
        { status: createRes.status }
      )
    }

    const estimateId = createRes.estimateId
    const estimateNumber = (createRes.estimate.estimate_number as string) || null

    const { data: updatedRows, error: updErr } = await supabase
      .from("proposals")
      .update({
        status: "converted",
        converted_estimate_id: estimateId,
        converted_at: new Date().toISOString(),
      })
      .eq("id", proposalId)
      .eq("business_id", businessId)
      .eq("status", "accepted")
      .is("deleted_at", null)
      .select("id, status, converted_estimate_id, converted_at")

    if (updErr) {
      await supabase.from("estimates").delete().eq("id", estimateId)
      return NextResponse.json(
        {
          success: false,
          error: "Estimate was created but linking it to the proposal failed. The draft quote was removed to avoid an orphan record. Please try again.",
          phase: "proposal_link_failed",
        },
        { status: 500 }
      )
    }

    if (!updatedRows || updatedRows.length === 0) {
      await supabase.from("estimates").delete().eq("id", estimateId)
      return NextResponse.json(
        {
          success: false,
          error:
            "Could not complete conversion (the proposal may have changed). No estimate was kept. Refresh and try again if the proposal is still accepted.",
          phase: "optimistic_lock_failed",
        },
        { status: 409 }
      )
    }

    const updated = updatedRows[0] as {
      id: string
      status: string
      converted_estimate_id: string
      converted_at: string
    }

    await createAuditLog({
      businessId,
      userId: user.id,
      actionType: "proposal.converted_to_estimate",
      entityType: "proposal",
      entityId: proposalId,
      newValues: {
        proposal_id: proposalId,
        estimate_id: estimateId,
        proposal_number: proposal.proposal_number ?? null,
        estimate_number: estimateNumber,
      },
      description: `Converted proposal ${refLabel} to estimate ${estimateNumber || estimateId}`,
      request,
    })

    return NextResponse.json(
      {
        success: true,
        estimate_id: estimateId,
        estimate_number: estimateNumber,
        proposal: updated,
      },
      { status: 201 }
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Conversion failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
