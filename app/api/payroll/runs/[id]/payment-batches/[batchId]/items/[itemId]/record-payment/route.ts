import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { mapPayrollPaymentAtomicError } from "@/lib/payroll/mapPayrollPaymentAtomicError"

export async function POST(
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

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

    const paymentDate = String(body.payment_date || "")
    const paymentAccountId = String(body.payment_account_id || "")
    const reference = body.reference ? String(body.reference).trim() : null
    const notes = body.notes ? String(body.notes).trim() : null
    const idempotencyKey = String(body.idempotency_key || body.idempotencyKey || randomUUID()).trim()

    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      return NextResponse.json({ error: "payment_date must be YYYY-MM-DD" }, { status: 400 })
    }
    if (!paymentAccountId) {
      return NextResponse.json({ error: "payment_account_id is required" }, { status: 400 })
    }
    if (!idempotencyKey) {
      return NextResponse.json({ error: "idempotency_key is required" }, { status: 400 })
    }

    const { data: result, error: rpcError } = await supabase.rpc(
      "record_payroll_batch_item_payment_atomic",
      {
        p_business_id: business.id,
        p_payroll_run_id: runId,
        p_batch_id: batchId,
        p_batch_item_id: itemId,
        p_payment_date: paymentDate,
        p_payment_account_id: paymentAccountId,
        p_reference: reference,
        p_notes: notes,
        p_actor_id: user.id,
        p_idempotency_key: idempotencyKey,
      }
    )

    if (rpcError) {
      const mapped = mapPayrollPaymentAtomicError(rpcError)
      const { status, ...payload } = mapped
      return NextResponse.json(payload, { status })
    }

    return NextResponse.json(
      {
        ...((result as Record<string, unknown>) || {}),
        reused: Boolean((result as { reused?: boolean } | null)?.reused),
      },
      { status: (result as { reused?: boolean })?.reused ? 200 : 201 }
    )
  } catch (e: any) {
    console.error("[batch item record-payment]", e)
    return NextResponse.json({ error: e.message || "Internal server error" }, { status: 500 })
  }
}
