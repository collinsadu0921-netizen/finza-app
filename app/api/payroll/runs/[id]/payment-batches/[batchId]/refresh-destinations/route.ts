import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { refreshBatchItemDestinations } from "@/lib/payroll/batchDestinationRefresh"

/**
 * Refresh unpaid batch instructions from current employee default payment
 * methods. Amounts, statuses and completed/in-progress transfers are untouched.
 */
export async function POST(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; batchId: string }> | { id: string; batchId: string } }
) {
  try {
    const { id: runId, batchId } = await Promise.resolve(params)
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDenied = await enforceServiceIndustryMinTierWrite(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDenied) return tierDenied

    const { allowed } = await requirePermission(
      supabase,
      user.id,
      business.id,
      PERMISSIONS.PAYROLL_PAY
    )
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const { data: batch, error: batchError } = await supabase
      .from("payroll_payment_batches")
      .select("id, status")
      .eq("id", batchId)
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .maybeSingle()

    if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 })
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 })
    if (String(batch.status) === "cancelled") {
      return NextResponse.json({ updated: 0 })
    }

    const result = await refreshBatchItemDestinations({
      supabase,
      businessId: business.id,
      payrollRunId: runId,
      batchId,
    })

    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error("[payment-batch refresh destinations]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
