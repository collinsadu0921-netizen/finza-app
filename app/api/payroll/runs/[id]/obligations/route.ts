import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { computePayrollObligationDisplayFields } from "@/lib/payroll/obligations"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const runId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDenied = await enforceServiceIndustryMinTier(
      supabase, user.id, business.id, "professional"
    )
    if (tierDenied) return tierDenied

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_VIEW)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("id,business_id,status,payroll_month,total_net_salary,total_paye,total_deductions,total_ssnit_employee,total_ssnit_employer")
      .eq("id", runId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()
    if (runError || !payrollRun) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 })

    const { data: obligations } = await supabase
      .from("payroll_obligations")
      .select("*")
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })

    const { data: postedAdvanceRepayments } = await supabase
      .from("salary_advance_repayments")
      .select("amount")
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .eq("status", "posted")

    const salaryAdvanceRecoveredOnApproval = (postedAdvanceRepayments || []).reduce(
      (sum, row: any) => sum + Number(row.amount || 0),
      0
    )

    const { data: payrollPaymentRows } = await supabase
      .from("payroll_payments")
      .select("amount")
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)

    const payrollPaymentsSum = (payrollPaymentRows || []).reduce(
      (sum, row: any) => sum + Number(row.amount || 0),
      0
    )

    const items = (obligations || []).map((o: any) => {
      const v = computePayrollObligationDisplayFields(o as Record<string, unknown>, {
        payrollPaymentsSum,
        salaryAdvanceRecoveredOnApproval,
      })
      return {
        ...o,
        label: v.label,
        amount_due: v.amount_due,
        amount_paid: v.amount_paid,
        outstanding_amount: v.outstanding_amount,
        status: v.status,
        is_payable: v.is_payable,
        status_display: v.status_display,
        internal_note: v.internal_note,
      }
    })

    const totalDue = items.reduce((s: number, o: any) => s + o.amount_due, 0)
    const totalPaid = items.reduce((s: number, o: any) => s + o.amount_paid, 0)
    const totalOutstanding = items.reduce((s: number, o: any) => s + o.outstanding_amount, 0)
    const salaryOutstanding = items
      .filter((o: any) => o.obligation_type === "salary_net")
      .reduce((s: number, o: any) => s + o.outstanding_amount, 0)
    const statutoryOutstanding = items
      .filter((o: any) => ["paye_gra", "ssnit_tier1", "tier2_pension"].includes(o.obligation_type))
      .reduce((s: number, o: any) => s + o.outstanding_amount, 0)

    return NextResponse.json({
      payrollRun,
      obligations: items,
      canGenerateObligations: items.length === 0 && ["approved", "locked"].includes(String(payrollRun.status || "")),
      totals: {
        total_due: totalDue,
        total_paid: totalPaid,
        total_outstanding: totalOutstanding,
        salary_outstanding: salaryOutstanding,
        statutory_outstanding: statutoryOutstanding,
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

