import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission, requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier, enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { mapPayrollBatchWorkflowError } from "@/lib/payroll/mapPayrollBatchWorkflowError"

async function loadBatchForRun(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  businessId: string,
  runId: string,
  batchId: string
): Promise<{ error: string } | { notFound: true } | { batch: Record<string, unknown> }> {
  const { data: batch, error } = await supabase
    .from("payroll_payment_batches")
    .select("*")
    .eq("id", batchId)
    .eq("business_id", businessId)
    .eq("payroll_run_id", runId)
    .is("deleted_at", null)
    .maybeSingle()

  if (error) return { error: error.message }
  if (!batch) return { notFound: true }
  return { batch }
}

export async function GET(
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

    const tierDenied = await enforceServiceIndustryMinTier(supabase, user.id, business.id, "professional")
    if (tierDenied) return tierDenied

    const canView = await hasPermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_VIEW)
    const canPay = await hasPermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!canView && !canPay) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const loaded = await loadBatchForRun(supabase, business.id, runId, batchId)
    if ("error" in loaded) {
      return NextResponse.json({ error: loaded.error }, { status: 500 })
    }
    if ("notFound" in loaded) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 })
    }
    const batch = loaded.batch

    const { data: items, error: iErr } = await supabase
      .from("payroll_payment_batch_items")
      .select("*")
      .eq("batch_id", batchId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("employee_name", { ascending: true })

    if (iErr) {
      console.error("[payment-batch GET items]", iErr)
      return NextResponse.json({ error: iErr.message }, { status: 500 })
    }

    return NextResponse.json({ batch, items: items || [] })
  } catch (e: any) {
    console.error("[payment-batch GET]", e)
    return NextResponse.json({ error: e.message || "Internal server error" }, { status: 500 })
  }
}

const ALLOWED_STATUSES = new Set(["draft", "ready", "processing", "cancelled"])

export async function PATCH(
  request: NextRequest,
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

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const nextStatus = typeof body.status === "string" ? body.status.trim() : ""
    if (!nextStatus || !ALLOWED_STATUSES.has(nextStatus)) {
      return NextResponse.json(
        {
          error: "status must be one of: draft, ready, processing, cancelled",
          code: "PAYROLL_BATCH_INVALID_STATUS_TRANSITION",
        },
        { status: 400 }
      )
    }

    const { data: result, error: rpcError } = await supabase.rpc(
      "transition_payroll_payment_batch_status_atomic",
      {
        p_business_id: business.id,
        p_payroll_run_id: runId,
        p_batch_id: batchId,
        p_next_status: nextStatus,
      }
    )

    if (rpcError) {
      const mapped = mapPayrollBatchWorkflowError(rpcError)
      const { status, ...payload } = mapped
      return NextResponse.json(payload, { status })
    }

    const { data: batch, error: reloadError } = await supabase
      .from("payroll_payment_batches")
      .select("*")
      .eq("id", batchId)
      .eq("business_id", business.id)
      .single()

    if (reloadError || !batch) {
      return NextResponse.json(
        {
          ...(result as Record<string, unknown>),
          warning: "Transition succeeded but batch reload failed",
        },
        { status: 200 }
      )
    }

    return NextResponse.json({
      batch,
      ...(result as Record<string, unknown>),
      reused: Boolean((result as { reused?: boolean } | null)?.reused),
    })
  } catch (e: any) {
    console.error("[payment-batch PATCH]", e)
    return NextResponse.json({ error: e.message || "Internal server error" }, { status: 500 })
  }
}
