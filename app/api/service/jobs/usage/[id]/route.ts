import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { logAudit } from "@/lib/auditLog"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/** Statuses still allowed via PATCH. Return must use POST .../return RPC. */
const ALLOWED_STATUSES = ["allocated", "consumed"] as const

/**
 * PATCH /api/service/jobs/usage/[id]
 * Update usage status. Only allocated -> consumed posts to ledger (DB trigger).
 * status=returned is rejected — use POST /api/service/jobs/usage/[id]/return.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: usageId } = await params
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { status, business_id: bodyBusinessId } = body as {
      status?: string
      business_id?: string
    }

    if (status === "returned") {
      return NextResponse.json(
        {
          error:
            "Direct status mutation to returned is not allowed. Use POST /api/service/jobs/usage/[id]/return.",
          code: "RETURN_VIA_RPC_REQUIRED",
        },
        { status: 400 }
      )
    }

    if (!status || !ALLOWED_STATUSES.includes(status as (typeof ALLOWED_STATUSES)[number])) {
      return NextResponse.json(
        {
          error: "status must be one of: allocated, consumed",
          code: "VALIDATION_ERROR",
        },
        { status: 400 }
      )
    }

    const scope = await resolveBusinessScopeForUser(supabase, user.id, bodyBusinessId ?? null)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error, code: "BUSINESS_SCOPE" }, { status: scope.status })
    }
    const businessId = scope.businessId

    const denied = await enforceServiceIndustryMinTier(supabase, user.id, businessId, "professional")
    if (denied) return denied

    const { data: existing, error: fetchErr } = await supabase
      .from("service_job_material_usage")
      .select("id, business_id, status")
      .eq("id", usageId)
      .eq("business_id", businessId)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Usage record not found", code: "USAGE_NOT_FOUND" }, { status: 404 })
    }

    const currentStatus = existing.status as string
    if (currentStatus === "consumed") {
      return NextResponse.json(
        { error: "Already consumed; cannot change status", code: "ALREADY_CONSUMED" },
        { status: 400 }
      )
    }
    if (currentStatus === "returned") {
      return NextResponse.json(
        { error: "Already returned; cannot change status", code: "USAGE_ALREADY_RETURNED" },
        { status: 400 }
      )
    }

    const { error: updateErr } = await supabase
      .from("service_job_material_usage")
      .update({ status })
      .eq("id", usageId)
      .eq("business_id", businessId)

    if (updateErr) {
      console.error("Usage status update error:", updateErr)
      return NextResponse.json({ error: "Failed to update status", code: "UPDATE_FAILED" }, { status: 500 })
    }

    await logAudit({
      businessId,
      userId: user.id,
      actionType:
        status === "consumed"
          ? "service_job.material_consumed"
          : "service_job.material_usage_updated",
      entityType: "service_job_material_usage",
      entityId: usageId,
      oldValues: { status: currentStatus },
      newValues: { status },
      description: `Service job material usage set to ${status}`,
      request,
    })

    return NextResponse.json({ success: true, status })
  } catch (err: unknown) {
    console.error("Usage status error:", err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Internal server error",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    )
  }
}
