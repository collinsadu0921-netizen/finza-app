import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

function deriveStatus(amountDue: number, amountPaid: number): "unpaid" | "partially_paid" | "paid" {
  const outstanding = Math.max(0, amountDue - amountPaid)
  if (amountDue <= 0 || outstanding <= 0.01) return "paid"
  if (amountPaid > 0) return "partially_paid"
  return "unpaid"
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; obligationId: string }> | { id: string; obligationId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const runId = resolvedParams.id
    const obligationId = resolvedParams.obligationId

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

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAY)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

    const paymentDate = String(body.payment_date || "")
    const amount = Number(body.amount)
    const paymentAccountId = String(body.payment_account_id || "")
    const reference = body.reference ? String(body.reference).trim() : null
    const notes = body.notes ? String(body.notes).trim() : null

    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      return NextResponse.json({ error: "payment_date must be YYYY-MM-DD" }, { status: 400 })
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })
    }
    if (!paymentAccountId) {
      return NextResponse.json({ error: "payment_account_id is required" }, { status: 400 })
    }

    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("id,status")
      .eq("id", runId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()
    if (runError || !payrollRun) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 })

    if (!["approved", "locked"].includes(String(payrollRun.status || ""))) {
      return NextResponse.json({ error: `Payroll run status "${payrollRun.status}" is not payable` }, { status: 400 })
    }

    const { data: obligation, error: obligationError } = await supabase
      .from("payroll_obligations")
      .select("*")
      .eq("id", obligationId)
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .single()
    if (obligationError || !obligation) return NextResponse.json({ error: "Payroll obligation not found" }, { status: 404 })

    const obligationDue = Number(obligation.amount_due || 0)
    const obligationPaid = Number(obligation.amount_paid || 0)
    const isOtherDeductions = obligation.obligation_type === "other_employee_deductions"

    let salaryAdvanceRecoveredOnApproval = 0
    if (isOtherDeductions) {
      const { data: postedAdvanceRepayments } = await supabase
        .from("salary_advance_repayments")
        .select("amount")
        .eq("business_id", business.id)
        .eq("payroll_run_id", runId)
        .eq("status", "posted")

      salaryAdvanceRecoveredOnApproval = (postedAdvanceRepayments || []).reduce(
        (sum, row: any) => sum + Number(row.amount || 0),
        0
      )

      const recoveredAmount = Math.min(obligationDue, salaryAdvanceRecoveredOnApproval)
      if (recoveredAmount >= obligationDue - 0.01) {
        return NextResponse.json(
          {
            error:
              "This deduction obligation is an internal salary advance recovery already cleared on payroll approval. No payment is required.",
          },
          { status: 400 }
        )
      }
    }

    const effectivePaid = isOtherDeductions
      ? Math.min(obligationDue, Math.max(obligationPaid, salaryAdvanceRecoveredOnApproval))
      : obligationPaid
    const outstanding = Math.max(0, obligationDue - effectivePaid)
    if (amount - outstanding > 0.01) {
      return NextResponse.json(
        { error: `Payment amount exceeds outstanding obligation (outstanding: ${outstanding.toFixed(2)})` },
        { status: 400 }
      )
    }

    const { data: paymentAccount } = await supabase
      .from("accounts")
      .select("id, code, sub_type, type, deleted_at, business_id")
      .eq("id", paymentAccountId)
      .eq("business_id", business.id)
      .single()

    const subType = String(paymentAccount?.sub_type || "").toLowerCase()
    const code = String(paymentAccount?.code || "")
    const isAllowedAssetAccount =
      paymentAccount &&
      paymentAccount.type === "asset" &&
      paymentAccount.deleted_at == null &&
      (["cash", "bank", "momo", "mobile_money"].includes(subType) || ["1000", "1010", "1020"].includes(code))

    if (!isAllowedAssetAccount) {
      return NextResponse.json(
        { error: "Selected payment account is invalid. Choose an active cash/bank/momo asset account." },
        { status: 400 }
      )
    }

    const { data: payment, error: insertError } = await supabase
      .from("payroll_obligation_payments")
      .insert({
        business_id: business.id,
        payroll_run_id: runId,
        payroll_obligation_id: obligationId,
        payment_date: paymentDate,
        amount,
        payment_account_id: paymentAccountId,
        reference: reference || null,
        notes: notes || null,
        created_by: user.id,
      })
      .select("*")
      .single()

    if (insertError || !payment) {
      return NextResponse.json({ error: insertError?.message || "Failed to create obligation payment" }, { status: 500 })
    }

    const { data: journalEntryId, error: postError } = await supabase.rpc(
      "post_payroll_obligation_payment_to_ledger",
      { p_payroll_obligation_payment_id: payment.id }
    )
    if (postError || !journalEntryId) {
      await supabase.from("payroll_obligation_payments").delete().eq("id", payment.id)
      return NextResponse.json(
        { error: postError?.message || "Failed to post obligation payment to ledger" },
        { status: 500 }
      )
    }

    const { data: paidRows } = await supabase
      .from("payroll_obligation_payments")
      .select("amount,payment_date,reference")
      .eq("business_id", business.id)
      .eq("payroll_obligation_id", obligationId)
      .is("deleted_at", null)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false })

    const totalPaid = (paidRows || []).reduce((sum, row: any) => sum + Number(row.amount || 0), 0)
    const effectiveTotalPaid = isOtherDeductions
      ? Math.min(obligationDue, Math.max(totalPaid, salaryAdvanceRecoveredOnApproval))
      : totalPaid
    const newStatus = deriveStatus(obligationDue, effectiveTotalPaid)
    const latest = (paidRows || [])[0]

    await supabase
      .from("payroll_obligations")
      .update({
        amount_paid: effectiveTotalPaid,
        status: newStatus,
        payment_account_id: paymentAccountId,
        latest_payment_date: latest?.payment_date ?? paymentDate,
        latest_payment_reference: latest?.reference ?? reference ?? null,
        journal_entry_id: journalEntryId,
      })
      .eq("id", obligationId)

    return NextResponse.json({
      payment: { ...payment, journal_entry_id: journalEntryId },
      obligation: {
        ...obligation,
        amount_paid: effectiveTotalPaid,
        outstanding_amount: Math.max(0, obligationDue - effectiveTotalPaid),
        status: newStatus,
        latest_payment_date: latest?.payment_date ?? paymentDate,
        latest_payment_reference: latest?.reference ?? reference ?? null,
      },
    }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

