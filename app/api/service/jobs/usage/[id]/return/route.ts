import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { logAudit } from "@/lib/auditLog"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  mapJobMaterialReturnRpcError,
  type JobMaterialReturnResult,
} from "@/lib/service/jobMaterialReturnErrors"

/**
 * POST /api/service/jobs/usage/[id]/return
 * Atomically return job material usage to stock via return_service_job_material_usage RPC.
 * Does not mutate stock/movements/journals in the application layer.
 */
export async function POST(
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
    const {
      business_id: bodyBusinessId,
      return_date: bodyReturnDate,
      idempotency_key: bodyIdempotencyKey,
    } = body as {
      business_id?: string
      return_date?: string
      idempotency_key?: string
    }

    const scope = await resolveBusinessScopeForUser(supabase, user.id, bodyBusinessId ?? null)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error, code: "BUSINESS_SCOPE" }, { status: scope.status })
    }
    const businessId = scope.businessId

    const denied = await enforceServiceIndustryMinTier(supabase, user.id, businessId, "professional")
    if (denied) return denied

    const returnDate =
      typeof bodyReturnDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(bodyReturnDate.trim())
        ? bodyReturnDate.trim()
        : new Date().toISOString().slice(0, 10)

    const idempotencyKey =
      typeof bodyIdempotencyKey === "string" && bodyIdempotencyKey.trim()
        ? bodyIdempotencyKey.trim()
        : randomUUID()

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "return_service_job_material_usage",
      {
        p_usage_id: usageId,
        p_business_id: businessId,
        p_return_date: returnDate,
        p_idempotency_key: idempotencyKey,
        p_returned_by: user.id,
      }
    )

    if (rpcError) {
      const mapped = mapJobMaterialReturnRpcError(rpcError.message)
      return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status })
    }

    if (!rpcResult || typeof rpcResult !== "object") {
      return NextResponse.json(
        { error: "Material return failed", code: "MATERIAL_RETURN_FAILED" },
        { status: 500 }
      )
    }

    const result = rpcResult as JobMaterialReturnResult

    await logAudit({
      businessId,
      userId: user.id,
      actionType: "service_job.material_returned",
      entityType: "service_job_material_usage",
      entityId: usageId,
      newValues: {
        status: result.status,
        quantity_restored: result.quantity_restored,
        return_movement_id: result.return_movement_id,
        return_journal_entry_id: result.return_journal_entry_id,
        original_cogs_journal_entry_id: result.original_cogs_journal_entry_id,
        return_date: result.return_date,
        idempotent: result.idempotent ?? false,
        idempotency_key: idempotencyKey,
      },
      description: "Service job material returned to stock",
      request,
    })

    return NextResponse.json({
      success: true,
      result,
      idempotent: result.idempotent ?? false,
    })
  } catch (err: unknown) {
    console.error("Usage return error:", err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Internal server error",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    )
  }
}
