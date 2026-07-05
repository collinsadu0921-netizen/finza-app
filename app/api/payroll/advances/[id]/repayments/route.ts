/**
 * POST /api/payroll/advances/[id]/repayments
 *   Records a salary advance repayment against a payroll run and updates advance status.
 *   Does not post to the ledger (ledger integration deferred to a separate migration).
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  applyRepaymentToAdvance,
  computeOutstandingAmount,
  validateRepaymentAmount,
} from "@/lib/payroll/salaryAdvanceRepayments"

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

    const { amount, payroll_run_id, payroll_entry_id } = body
    const repaymentAmount = Number(amount)
    if (!payroll_run_id) {
      return NextResponse.json({ error: "payroll_run_id is required" }, { status: 400 })
    }

    const { data: advance, error: advanceError } = await supabase
      .from("salary_advances")
      .select("id, business_id, staff_id, amount, repaid_amount, status, cancelled_at, cleared_at")
      .eq("id", advanceId)
      .eq("business_id", business.id)
      .single()

    if (advanceError || !advance) {
      return NextResponse.json({ error: "Salary advance not found" }, { status: 404 })
    }

    if (advance.cancelled_at || advance.status === "cancelled") {
      return NextResponse.json({ error: "Cannot record repayment on a cancelled advance" }, { status: 400 })
    }

    if (advance.status === "cleared") {
      return NextResponse.json({ error: "Advance is already fully repaid" }, { status: 400 })
    }

    const outstanding = computeOutstandingAmount(Number(advance.amount), Number(advance.repaid_amount || 0))
    const validationError = validateRepaymentAmount(repaymentAmount, outstanding)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("id, business_id, status")
      .eq("id", payroll_run_id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (runError || !payrollRun) {
      return NextResponse.json({ error: "Payroll run not found" }, { status: 404 })
    }

    if (payroll_entry_id) {
      const { data: entry, error: entryError } = await supabase
        .from("payroll_entries")
        .select("id, staff_id, payroll_run_id")
        .eq("id", payroll_entry_id)
        .eq("payroll_run_id", payroll_run_id)
        .single()

      if (entryError || !entry) {
        return NextResponse.json({ error: "Payroll entry not found for this run" }, { status: 404 })
      }
      if (String(entry.staff_id) !== String(advance.staff_id)) {
        return NextResponse.json(
          { error: "Payroll entry does not belong to the advance staff member" },
          { status: 400 }
        )
      }
    }

    const postedAt = new Date().toISOString()
    const { data: repayment, error: repaymentError } = await supabase
      .from("salary_advance_repayments")
      .insert({
        business_id: business.id,
        salary_advance_id: advance.id,
        staff_id: advance.staff_id,
        payroll_run_id,
        payroll_entry_id: payroll_entry_id ?? null,
        amount: repaymentAmount,
        status: "posted",
        posted_at: postedAt,
      })
      .select()
      .single()

    if (repaymentError) {
      if (repaymentError.code === "23505") {
        return NextResponse.json(
          { error: "A repayment for this advance and payroll entry already exists" },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: repaymentError.message }, { status: 500 })
    }

    const updatedAdvanceFields = applyRepaymentToAdvance({
      amount: Number(advance.amount),
      repaid_amount: Number(advance.repaid_amount || 0),
      cancelled_at: advance.cancelled_at,
      cleared_at: advance.cleared_at,
      repaymentAmount,
    })

    const { data: updatedAdvance, error: updateError } = await supabase
      .from("salary_advances")
      .update(updatedAdvanceFields)
      .eq("id", advance.id)
      .eq("business_id", business.id)
      .select()
      .single()

    if (updateError) {
      await supabase.from("salary_advance_repayments").delete().eq("id", repayment.id)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      repayment,
      advance: updatedAdvance,
      outstanding_amount: computeOutstandingAmount(
        Number(updatedAdvance.amount),
        Number(updatedAdvance.repaid_amount || 0)
      ),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Error in POST /api/payroll/advances/[id]/repayments:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
