/**
 * POST /api/assets/[id]/depreciation/reverse — reverse a posted depreciation entry
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { mapDepreciationRpcError } from "@/lib/assets/depreciationApiErrors"
import type { DepreciationReverseResult } from "@/lib/assets/depreciationAmount"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const assetId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found", code: "BUSINESS_NOT_FOUND" }, { status: 404 })
    }

    const tierDenied = await enforceServiceIndustryMinTierWrite(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDenied) return tierDenied

    const body = await request.json()
    const { depreciation_entry_id, reversal_date, reason } = body as {
      depreciation_entry_id?: string
      reversal_date?: string
      reason?: string
    }

    if (!depreciation_entry_id) {
      return NextResponse.json(
        { error: "depreciation_entry_id is required", code: "VALIDATION_ERROR" },
        { status: 400 }
      )
    }
    if (!reversal_date) {
      return NextResponse.json(
        { error: "reversal_date is required", code: "VALIDATION_ERROR" },
        { status: 400 }
      )
    }
    if (!reason || !String(reason).trim()) {
      return NextResponse.json(
        { error: "Reversal reason is required", code: "REASON_REQUIRED" },
        { status: 400 }
      )
    }

    const { data: entry } = await supabase
      .from("depreciation_entries")
      .select("id, asset_id, business_id")
      .eq("id", depreciation_entry_id)
      .eq("asset_id", assetId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .maybeSingle()

    if (!entry) {
      return NextResponse.json(
        { error: "Depreciation entry not found", code: "ENTRY_NOT_FOUND" },
        { status: 404 }
      )
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc("reverse_asset_depreciation", {
      p_depreciation_entry_id: depreciation_entry_id,
      p_reversal_date: reversal_date,
      p_reason: String(reason).trim(),
      p_reversed_by: user.id,
    })

    if (rpcError) {
      const mapped = mapDepreciationRpcError(rpcError.message)
      return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status })
    }

    if (!rpcResult || typeof rpcResult !== "object") {
      return NextResponse.json(
        { error: "Depreciation reversal failed", code: "REVERSAL_FAILED" },
        { status: 500 }
      )
    }

    const result = rpcResult as DepreciationReverseResult

    await createAuditLog({
      businessId: business.id,
      userId: user.id,
      actionType: "asset.depreciation.reversed",
      entityType: "depreciation_entry",
      entityId: result.depreciation_entry_id,
      newValues: {
        asset_id: assetId,
        reversal_entry_id: result.reversal_entry_id,
        journal_entry_id: result.journal_entry_id,
        amount: result.amount,
        reversal_date: result.reversal_date,
        reason: String(reason).trim(),
        idempotent: result.idempotent ?? false,
      },
      request,
    })

    return NextResponse.json({
      result,
      idempotent: result.idempotent ?? false,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Error reversing depreciation:", err)
    return NextResponse.json({ error: message, code: "INTERNAL_ERROR" }, { status: 500 })
  }
}
