/**
 * POST /api/payroll/advances/[id]/repayments
 * Direct cash/bank repayment with mandatory accounting via RPC.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { logAudit } from "@/lib/auditLog"
import { computeOutstandingAmount } from "@/lib/payroll/salaryAdvanceRepayments"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: advanceId } = await params
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
      PERMISSIONS.PAYROLL_CREATE
    )
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    // Legacy payroll_run_id-only path is no longer supported without accounting.
    if (body.payroll_run_id && !body.payment_account_id) {
      return NextResponse.json(
        {
          error:
            "Direct payroll-run repayment without accounting is no longer supported. Use payroll approval for payroll recoveries, or provide payment_account_id for a direct cash/bank repayment.",
          code: "SALARY_ADVANCE_DIRECT_REPAYMENT_REQUIRES_ACCOUNTING",
        },
        { status: 400 }
      )
    }

    const repaymentAmount = Number(body.amount)
    const paymentAccountId = body.payment_account_id ? String(body.payment_account_id) : ""
    const paymentDate = body.payment_date ? String(body.payment_date).slice(0, 10) : ""
    const idempotencyKey = body.idempotency_key ? String(body.idempotency_key).trim() : ""
    const reference = body.reference != null ? String(body.reference) : null

    if (!paymentAccountId) {
      return NextResponse.json({ error: "payment_account_id is required" }, { status: 400 })
    }
    if (!paymentDate) {
      return NextResponse.json({ error: "payment_date is required" }, { status: 400 })
    }
    if (!idempotencyKey) {
      return NextResponse.json({ error: "idempotency_key is required" }, { status: 400 })
    }

    const { data: advance, error: advanceError } = await supabase
      .from("salary_advances")
      .select("id, business_id, staff_id, amount, repaid_amount, status, cancelled_at")
      .eq("id", advanceId)
      .eq("business_id", business.id)
      .single()

    if (advanceError || !advance) {
      return NextResponse.json({ error: "Salary advance not found" }, { status: 404 })
    }

    const { data: result, error: rpcError } = await supabase.rpc("post_salary_advance_direct_repayment", {
      p_business_id: business.id,
      p_advance_id: advanceId,
      p_amount: repaymentAmount,
      p_payment_account_id: paymentAccountId,
      p_payment_date: paymentDate,
      p_idempotency_key: idempotencyKey,
      p_reference: reference,
      p_user_id: user.id,
    })

    if (rpcError) {
      const message = rpcError.message || "Failed to post direct repayment"
      const status =
        /not found/i.test(message) ? 404 :
        /exceeds|cancelled|already|must be|required|positive|authorized|idempotency/i.test(message)
          ? 400
          : 500
      return NextResponse.json(
        {
          error: message,
          code: /exceeds/i.test(message)
            ? "SALARY_ADVANCE_RECOVERY_EXCEEDS_OUTSTANDING"
            : "SALARY_ADVANCE_DIRECT_REPAYMENT_FAILED",
          details: rpcError.details || null,
        },
        { status }
      )
    }

    const payload = result as Record<string, unknown>
    const reused = payload?.reused === true

    if (!reused) {
      await logAudit({
        businessId: business.id,
        userId: user.id,
        actionType: "salary_advance.repaid_directly",
        entityType: "salary_advance",
        entityId: advanceId,
        newValues: {
          amount: payload?.amount,
          journal_entry_id: payload?.journal_entry_id,
          repayment_id: payload?.repayment_id,
          repayment_method: payload?.repayment_method,
          outstanding: payload?.outstanding,
        },
        description: "Salary advance repaid directly via cash/bank",
        request,
      })

      if (String(payload?.advance_status || "") === "cleared") {
        await logAudit({
          businessId: business.id,
          userId: user.id,
          actionType: "salary_advance.fully_repaid",
          entityType: "salary_advance",
          entityId: advanceId,
          newValues: {
            repaid_amount: payload?.repaid_amount,
            journal_entry_id: payload?.journal_entry_id,
          },
          description: "Salary advance fully repaid",
          request,
        })
      }
    }

    const { data: updatedAdvance } = await supabase
      .from("salary_advances")
      .select("*")
      .eq("id", advanceId)
      .eq("business_id", business.id)
      .single()

    return NextResponse.json({
      success: true,
      reused,
      repayment: {
        id: payload?.repayment_id,
        amount: payload?.amount,
        status: payload?.status,
        journal_entry_id: payload?.journal_entry_id,
        repayment_method: payload?.repayment_method,
      },
      advance: updatedAdvance,
      outstanding_amount:
        payload?.outstanding != null
          ? Number(payload.outstanding)
          : computeOutstandingAmount(
              Number(updatedAdvance?.amount || advance.amount),
              Number(updatedAdvance?.repaid_amount || 0)
            ),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Error in POST /api/payroll/advances/[id]/repayments:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
