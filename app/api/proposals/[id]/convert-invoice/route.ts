import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { enforceServiceIndustryFinancialWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite"
import { createDraftInvoiceFromProposal } from "@/lib/proposals/createDraftInvoiceFromProposal"

export const dynamic = "force-dynamic"

const bodySchema = z
  .object({
    business_id: z.string().uuid(),
    fx_rate: z.number().positive().finite().optional(),
  })
  .strict()

/**
 * POST /api/proposals/[id]/convert-invoice
 * Accepted proposal → draft invoice. The invoice is unnumbered and unissued
 * until staff review, and the proposal is linked to prevent duplicates.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const scope = await resolveBusinessScopeForUser(supabase, user.id, parsed.data.business_id)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const businessId = scope.businessId

    const writeDenied = await enforceServiceIndustryFinancialWrite(
      supabase,
      user.id,
      businessId,
      "starter"
    )
    if (writeDenied) return writeDenied

    const { data: proposal, error: loadError } = await supabase
      .from("proposals")
      .select(
        "id, business_id, customer_id, title, proposal_number, status, pricing_mode, pricing_payload, currency_code, converted_estimate_id, converted_invoice_id, deleted_at"
      )
      .eq("id", proposalId)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .maybeSingle()

    if (loadError || !proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
    }

    if (proposal.converted_invoice_id) {
      return NextResponse.json(
        {
          error: "This proposal already has a linked invoice.",
          converted_invoice_id: proposal.converted_invoice_id,
        },
        { status: 409 }
      )
    }
    if (proposal.converted_estimate_id) {
      return NextResponse.json(
        {
          error:
            "This proposal is already linked to an estimate. Create the invoice from that estimate instead.",
          converted_estimate_id: proposal.converted_estimate_id,
        },
        { status: 409 }
      )
    }

    const result = await createDraftInvoiceFromProposal({
      supabase,
      userId: user.id,
      businessId,
      proposal: {
        id: String(proposal.id),
        business_id: String(proposal.business_id),
        customer_id: (proposal.customer_id as string | null) ?? null,
        title: String(proposal.title ?? ""),
        proposal_number: (proposal.proposal_number as string | null) ?? null,
        status: String(proposal.status ?? ""),
        pricing_mode: String(proposal.pricing_mode ?? "none"),
        pricing_payload: proposal.pricing_payload,
        currency_code: (proposal.currency_code as string | null) ?? null,
        converted_estimate_id: (proposal.converted_estimate_id as string | null) ?? null,
        converted_invoice_id: (proposal.converted_invoice_id as string | null) ?? null,
      },
      fxRate: parsed.data.fx_rate ?? null,
      request,
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          ...(result.converted_invoice_id
            ? { converted_invoice_id: result.converted_invoice_id }
            : {}),
        },
        { status: result.status }
      )
    }

    return NextResponse.json(
      {
        success: true,
        invoice_id: result.invoiceId,
        invoice_number: null,
        proposal: { id: proposalId, status: "converted" },
      },
      { status: 201 }
    )
  } catch (error: unknown) {
    console.error("[proposals.convert-invoice] failed", {
      name: error instanceof Error ? error.name : "unknown",
    })
    return NextResponse.json(
      { error: "Invoice conversion failed. Try again." },
      { status: 500 }
    )
  }
}
