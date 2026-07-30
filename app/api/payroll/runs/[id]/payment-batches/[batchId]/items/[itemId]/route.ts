import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { mapPayrollBatchWorkflowError } from "@/lib/payroll/mapPayrollBatchWorkflowError"

const ITEM_STATUSES = new Set(["pending", "failed", "skipped", "cancelled"])

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params:
      | Promise<{ id: string; batchId: string; itemId: string }>
      | { id: string; batchId: string; itemId: string }
  }
) {
  try {
    const { id: runId, batchId, itemId } = await Promise.resolve(params)
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

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const nextStatus =
      typeof body.status === "string" && body.status.trim() ? body.status.trim() : undefined

    if (!nextStatus || !ITEM_STATUSES.has(nextStatus)) {
      return NextResponse.json(
        {
          error:
            "status must be one of: pending, failed, skipped, cancelled. Use POST .../record-payment to record payment.",
          code: "PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED",
        },
        { status: 409 }
      )
    }

    const failureReason =
      body.failure_reason === undefined || body.failure_reason === null || body.failure_reason === ""
        ? null
        : String(body.failure_reason).trim() || null

    const { data: result, error: rpcError } = await supabase.rpc(
      "transition_payroll_payment_batch_item_status_atomic",
      {
        p_business_id: business.id,
        p_payroll_run_id: runId,
        p_batch_id: batchId,
        p_batch_item_id: itemId,
        p_next_status: nextStatus,
        p_failure_reason: failureReason,
      }
    )

    if (rpcError) {
      const mapped = mapPayrollBatchWorkflowError(rpcError)
      const { status, ...payload } = mapped
      return NextResponse.json(payload, { status })
    }

    const { data: item, error: itemErr } = await supabase
      .from("payroll_payment_batch_items")
      .select("*")
      .eq("id", itemId)
      .single()

    const { data: batch, error: batchErr } = await supabase
      .from("payroll_payment_batches")
      .select("*")
      .eq("id", batchId)
      .single()

    if (itemErr || batchErr || !item || !batch) {
      return NextResponse.json(
        {
          ...(result as Record<string, unknown>),
          warning: "Transition succeeded but reload failed",
        },
        { status: 200 }
      )
    }

    return NextResponse.json({
      item,
      batch,
      ...(result as Record<string, unknown>),
      reused: Boolean((result as { reused?: boolean } | null)?.reused),
    })
  } catch (e: any) {
    console.error("[batch item PATCH]", e)
    return NextResponse.json({ error: e.message || "Internal server error" }, { status: 500 })
  }
}
