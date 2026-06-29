import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { enforceServiceWorkspaceWriteAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import {
  fetchCitProvisionForAdjustment,
  isCitAdjustmentType,
  normalizePositiveAmount,
  recalculateCitProvisionFromAdjustments,
  validateCitAdjustmentAccount,
} from "../recalculate"

const DRAFT_ONLY_MESSAGE = "CIT adjustments can only be changed while the provision is in draft status."

type RouteContext = {
  params: Promise<{ id: string }>
}

async function loadAdjustmentAndProvision(supabase: any, adjustmentId: string) {
  const { data: adjustment, error: adjustmentError } = await supabase
    .from("cit_adjustments")
    .select("*")
    .eq("id", adjustmentId)
    .maybeSingle()

  if (adjustmentError) return { adjustment: null, provision: null, error: adjustmentError }
  if (!adjustment) return { adjustment: null, provision: null, error: null }

  const { provision, error: provisionError } = await fetchCitProvisionForAdjustment(supabase, adjustment.provision_id)
  return { adjustment, provision, error: provisionError }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { id } = await context.params
    const body = await request.json()

    const { adjustment, provision, error: loadError } = await loadAdjustmentAndProvision(supabase, id)
    if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })
    if (!adjustment || !provision || adjustment.business_id !== provision.business_id) {
      return NextResponse.json({ error: "Adjustment not found" }, { status: 404 })
    }
    if (provision.status !== "draft") {
      return NextResponse.json({ error: DRAFT_ONLY_MESSAGE }, { status: 400 })
    }

    const denied = await enforceServiceWorkspaceWriteAccess({
      supabase,
      userId: user?.id,
      businessId: provision.business_id,
      minTier: "business",
    })
    if (denied) return denied

    const updateData: Record<string, unknown> = {}
    if (body.adjustment_type !== undefined) {
      if (!isCitAdjustmentType(body.adjustment_type)) {
        return NextResponse.json({ error: "Invalid adjustment_type" }, { status: 400 })
      }
      updateData.adjustment_type = body.adjustment_type
    }
    if (body.category !== undefined) {
      if (!body.category || typeof body.category !== "string") {
        return NextResponse.json({ error: "category required" }, { status: 400 })
      }
      updateData.category = body.category.trim()
    }
    if (body.amount !== undefined) {
      const amount = normalizePositiveAmount(body.amount)
      if (amount == null) {
        return NextResponse.json({ error: "amount must be greater than 0" }, { status: 400 })
      }
      updateData.amount = amount
    }
    if (body.notes !== undefined) updateData.notes = body.notes || null
    if (body.account_id !== undefined) {
      const accountId = body.account_id || null
      const accountCheck = await validateCitAdjustmentAccount(supabase, {
        accountId,
        businessId: provision.business_id,
      })
      if (!accountCheck.ok) {
        return NextResponse.json({ error: accountCheck.error }, { status: accountCheck.status })
      }
      updateData.account_id = accountId
    }

    const { data: updatedAdjustment, error } = await supabase
      .from("cit_adjustments")
      .update(updateData)
      .eq("id", id)
      .eq("business_id", provision.business_id)
      .select("*, accounts(id, code, name)")
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { provision: updatedProvision, error: recalcError } = await recalculateCitProvisionFromAdjustments(
      supabase,
      provision
    )
    if (recalcError) return NextResponse.json({ error: recalcError.message }, { status: 500 })

    return NextResponse.json({ success: true, adjustment: updatedAdjustment, provision: updatedProvision })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { id } = await context.params

    const { adjustment, provision, error: loadError } = await loadAdjustmentAndProvision(supabase, id)
    if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })
    if (!adjustment || !provision || adjustment.business_id !== provision.business_id) {
      return NextResponse.json({ error: "Adjustment not found" }, { status: 404 })
    }
    if (provision.status !== "draft") {
      return NextResponse.json({ error: DRAFT_ONLY_MESSAGE }, { status: 400 })
    }

    const denied = await enforceServiceWorkspaceWriteAccess({
      supabase,
      userId: user?.id,
      businessId: provision.business_id,
      minTier: "business",
    })
    if (denied) return denied

    const { error } = await supabase
      .from("cit_adjustments")
      .delete()
      .eq("id", id)
      .eq("business_id", provision.business_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { provision: updatedProvision, error: recalcError } = await recalculateCitProvisionFromAdjustments(
      supabase,
      provision
    )
    if (recalcError) return NextResponse.json({ error: recalcError.message }, { status: 500 })

    return NextResponse.json({ success: true, provision: updatedProvision })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
