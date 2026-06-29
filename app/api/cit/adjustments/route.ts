import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import {
  enforceServiceWorkspaceAccess,
  enforceServiceWorkspaceWriteAccess,
} from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import {
  fetchCitProvisionForAdjustment,
  isCitAdjustmentType,
  normalizePositiveAmount,
  recalculateCitProvisionFromAdjustments,
  validateCitAdjustmentAccount,
} from "./recalculate"

const DRAFT_ONLY_MESSAGE = "CIT adjustments can only be changed while the provision is in draft status."

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { searchParams } = new URL(request.url)
    const provisionId = searchParams.get("provision_id")

    if (!provisionId) {
      return NextResponse.json({ error: "provision_id required" }, { status: 400 })
    }

    const { provision, error: provisionError } = await fetchCitProvisionForAdjustment(supabase, provisionId)
    if (provisionError) return NextResponse.json({ error: provisionError.message }, { status: 500 })
    if (!provision) return NextResponse.json({ error: "Provision not found" }, { status: 404 })

    const denied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user?.id,
      businessId: provision.business_id,
      minTier: "business",
    })
    if (denied) return denied

    const { data: adjustments, error } = await supabase
      .from("cit_adjustments")
      .select("*, accounts(id, code, name)")
      .eq("business_id", provision.business_id)
      .eq("provision_id", provision.id)
      .order("created_at", { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ adjustments: adjustments ?? [], provision })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    const body = await request.json()
    const { provision_id, adjustment_type, category, notes, account_id } = body
    const amount = normalizePositiveAmount(body.amount)

    if (!provision_id) return NextResponse.json({ error: "provision_id required" }, { status: 400 })
    if (!isCitAdjustmentType(adjustment_type)) {
      return NextResponse.json({ error: "Invalid adjustment_type" }, { status: 400 })
    }
    if (!category || typeof category !== "string") {
      return NextResponse.json({ error: "category required" }, { status: 400 })
    }
    if (amount == null) {
      return NextResponse.json({ error: "amount must be greater than 0" }, { status: 400 })
    }

    const { provision, error: provisionError } = await fetchCitProvisionForAdjustment(supabase, provision_id)
    if (provisionError) return NextResponse.json({ error: provisionError.message }, { status: 500 })
    if (!provision) return NextResponse.json({ error: "Provision not found" }, { status: 404 })
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

    const accountCheck = await validateCitAdjustmentAccount(supabase, {
      accountId: account_id || null,
      businessId: provision.business_id,
    })
    if (!accountCheck.ok) {
      return NextResponse.json({ error: accountCheck.error }, { status: accountCheck.status })
    }

    const { data: adjustment, error } = await supabase
      .from("cit_adjustments")
      .insert({
        business_id: provision.business_id,
        provision_id: provision.id,
        adjustment_type,
        category: category.trim(),
        amount,
        notes: notes || null,
        account_id: account_id || null,
        created_by: user?.id || null,
      })
      .select("*, accounts(id, code, name)")
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { provision: updatedProvision, error: recalcError } = await recalculateCitProvisionFromAdjustments(
      supabase,
      provision
    )
    if (recalcError) return NextResponse.json({ error: recalcError.message }, { status: 500 })

    return NextResponse.json({ success: true, adjustment, provision: updatedProvision })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
