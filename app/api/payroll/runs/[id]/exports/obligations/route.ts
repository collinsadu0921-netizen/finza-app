import { NextRequest, NextResponse } from "next/server"
import { csvResponse, formatNumeric } from "@/lib/payroll/csvExport"
import { computePayrollObligationDisplayFields } from "@/lib/payroll/obligations"
import {
  PAYROLL_EXPORT_PERIOD_HEADERS,
  payrollExportFilename,
  payrollExportPeriodValues,
} from "@/lib/payroll/payrollExportMetadata"
import { getAuthorizedPayrollRunForExport } from "../_shared"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const runId = resolvedParams.id
    const auth = await getAuthorizedPayrollRunForExport(request, runId)
    if ("error" in auth) return auth.error
    const { supabase, payrollRun, business } = auth

    const { data: obligations } = await supabase
      .from("payroll_obligations")
      .select("obligation_type,label,amount_due,amount_paid,status,due_date,liability_account_code,latest_payment_date,latest_payment_reference")
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
      (sum, row: { amount?: unknown }) => sum + Number(row.amount || 0),
      0
    )

    const { data: payrollPaymentRows } = await supabase
      .from("payroll_payments")
      .select("amount")
      .eq("business_id", business.id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)

    const payrollPaymentsSum = (payrollPaymentRows || []).reduce(
      (sum, row: { amount?: unknown }) => sum + Number(row.amount || 0),
      0
    )

    const periodValues = payrollExportPeriodValues(payrollRun)
    const rows: string[][] = [[
      ...PAYROLL_EXPORT_PERIOD_HEADERS,
      "Obligation Type",
      "Label",
      "Amount Due",
      "Amount Paid",
      "Outstanding Amount",
      "Status",
      "Due Date",
      "Liability Account Code",
      "Latest Payment Date",
      "Latest Payment Reference",
      "Notes",
    ]]

    for (const o of obligations || []) {
      const v = computePayrollObligationDisplayFields(o as Record<string, unknown>, {
        payrollPaymentsSum,
        salaryAdvanceRecoveredOnApproval,
      })
      rows.push([
        ...periodValues,
        String((o as Record<string, unknown>).obligation_type ?? ""),
        v.label,
        formatNumeric(v.amount_due),
        formatNumeric(v.amount_paid),
        formatNumeric(v.outstanding_amount),
        v.status_display,
        String((o as Record<string, unknown>).due_date ?? ""),
        String((o as Record<string, unknown>).liability_account_code ?? ""),
        String((o as Record<string, unknown>).latest_payment_date ?? ""),
        String((o as Record<string, unknown>).latest_payment_reference ?? ""),
        v.internal_note ?? "",
      ])
    }

    return csvResponse(payrollExportFilename("finza-payroll-obligations", payrollRun), rows)
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

