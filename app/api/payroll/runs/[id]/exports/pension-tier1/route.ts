import { NextRequest, NextResponse } from "next/server"
import { csvResponse, formatNumeric } from "@/lib/payroll/csvExport"
import {
  PAYROLL_EXPORT_PERIOD_HEADERS,
  payrollExportFilename,
  payrollPeriodCellValue,
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
    const { supabase, payrollRun } = auth

    const { data: entries } = await supabase
      .from("payroll_entries")
      .select(`
        basic_salary,
        pensionable_base,
        employee_pension_contribution,
        employer_pension_contribution,
        total_mandatory_pension,
        tier1_ssnit_remittance,
        staff:staff_id (name,ssnit_number,tin_number)
      `)
      .eq("payroll_run_id", runId)
      .order("staff(name)", { ascending: true })

    const fallbackWarning = (entries || []).some(
      (e: any) =>
        Number(e.pensionable_base || 0) <= 0 &&
        Number(e.tier1_ssnit_remittance || 0) <= 0 &&
        Number(e.employee_pension_contribution ?? e.ssnit_employee ?? 0) > 0.01
    )

    const rows: string[][] = [[
      ...PAYROLL_EXPORT_PERIOD_HEADERS,
      "Employee Name",
      "SSNIT Number",
      "TIN",
      "Basic Salary",
      "Pensionable Base",
      "Employee Pension Contribution 5.5%",
      "Employer Pension Contribution 13%",
      "Total Mandatory Pension 18.5%",
      "Tier 1 / SSNIT Remittance 13.5%",
    ]]

    const periodValues = [
      payrollPeriodCellValue(payrollRun),
      String(payrollRun.pay_period_start || payrollRun.payroll_month || "").slice(0, 10),
      String(payrollRun.pay_period_end || payrollRun.pay_period_start || payrollRun.payroll_month || "").slice(0, 10),
      String(payrollRun.payroll_frequency || "monthly"),
      String(payrollRun.run_type || "regular"),
    ]

    for (const e of entries || []) {
      const staff = (e as any).staff || {}
      rows.push([
        ...periodValues,
        String(staff.name || ""),
        String(staff.ssnit_number || ""),
        String(staff.tin_number || ""),
        formatNumeric((e as any).basic_salary),
        formatNumeric((e as any).pensionable_base),
        formatNumeric((e as any).employee_pension_contribution),
        formatNumeric((e as any).employer_pension_contribution),
        formatNumeric((e as any).total_mandatory_pension),
        formatNumeric((e as any).tier1_ssnit_remittance),
      ])
    }

    if (fallbackWarning) {
      rows.push([
        "NOTE",
        "Some employee pension details were incomplete on this run. Review totals before filing.",
      ])
    }

    return csvResponse(payrollExportFilename("finza-pension-tier1-schedule", payrollRun), rows)
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

