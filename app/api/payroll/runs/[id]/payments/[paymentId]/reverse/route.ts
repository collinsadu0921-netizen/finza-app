import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { mapPayrollPaymentAtomicError } from "@/lib/payroll/mapPayrollPaymentAtomicError"

/**
 * Reverse a recorded salary payment.
 *
 * This reverses Finza's accounting record only. It does not initiate a bank
 * refund, Mobile Money transfer or Paystack transaction.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> | { id: string; paymentId: string } }
) {
  try {
    const { id: runId, paymentId } = await Promise.resolve(params)
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
      PERMISSIONS.PAYROLL_REVERSE
    )
    if (!allowed) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "PAYROLL_PAYMENT_REVERSAL_PERMISSION_DENIED" },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

    const reversalDate = String(body.reversal_date || "").trim()
    const reason = String(body.reason || "").trim()

    if (!/^\d{4}-\d{2}-\d{2}$/.test(reversalDate)) {
      return NextResponse.json(
        {
          error: "reversal_date must be YYYY-MM-DD",
          code: "PAYROLL_PAYMENT_REVERSAL_INVALID_INPUT",
        },
        { status: 400 }
      )
    }

    if (reason.length < 3 || reason.length > 500) {
      return NextResponse.json(
        {
          error: "Reversal reason must contain between 3 and 500 characters",
          code: "PAYROLL_PAYMENT_REVERSAL_INVALID_INPUT",
        },
        { status: 400 }
      )
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payroll_payments")
      .select("id, payroll_run_id")
      .eq("id", paymentId)
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .maybeSingle()

    if (paymentError) {
      console.error("[payroll payment reverse] lookup", paymentError)
      return NextResponse.json({ error: paymentError.message }, { status: 500 })
    }

    if (!payment) {
      return NextResponse.json(
        { error: "Payroll payment not found", code: "PAYROLL_PAYMENT_REVERSAL_NOT_FOUND" },
        { status: 404 }
      )
    }

    const { data: result, error: rpcError } = await supabase.rpc(
      "reverse_payroll_payment_atomic",
      {
        p_business_id: business.id,
        p_payroll_payment_id: paymentId,
        p_reversal_date: reversalDate,
        p_reason: reason,
      }
    )

    if (rpcError) {
      const mapped = mapPayrollPaymentAtomicError(rpcError)
      const { status, ...payload } = mapped
      return NextResponse.json(payload, { status })
    }

    return NextResponse.json({
      ...((result as Record<string, unknown>) || {}),
      reused: Boolean((result as { reused?: boolean } | null)?.reused),
    })
  } catch (e: unknown) {
    console.error("[payroll payment reverse]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
