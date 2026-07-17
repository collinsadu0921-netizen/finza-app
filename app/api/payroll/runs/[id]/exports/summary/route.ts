import { NextRequest, NextResponse } from "next/server"
import { csvResponse, formatNumeric } from "@/lib/payroll/csvExport"
import {
  PAYROLL_EXPORT_PERIOD_HEADERS,
  payrollExportFilename,
  payrollExportPeriodValues,
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

    const { supabase, business, payrollRun } = auth

    const { data: entries } = await supabase
      .from("payroll_entries")
      .select("regular_allowances_amount,bonus_amount,overtime_amount,employee_pension_contribution,employer_pension_contribution,total_mandatory_pension,tier1_ssnit_remittance,tier2_pension_remittance,ssnit_employee,ssnit_employer")
      .eq("payroll_run_id", runId)

    const sums = (entries || []).reduce(
      (acc: any, e: any) => {
        acc.regularAllowances += Number(e.regular_allowances_amount || 0)
        acc.bonus += Number(e.bonus_amount || 0)
        acc.overtime += Number(e.overtime_amount || 0)
        acc.employeePension += Number(e.employee_pension_contribution ?? e.ssnit_employee ?? 0)
        acc.employerPension += Number(e.employer_pension_contribution ?? e.ssnit_employer ?? 0)
        acc.totalMandatory += Number(e.total_mandatory_pension || 0)
        acc.tier1 += Number(e.tier1_ssnit_remittance || 0)
        acc.tier2 += Number(e.tier2_pension_remittance || 0)
        return acc
      },
      { regularAllowances: 0, bonus: 0, overtime: 0, employeePension: 0, employerPension: 0, totalMandatory: 0, tier1: 0, tier2: 0 }
    )

    const employerCost = Number(payrollRun.total_gross_salary || 0) + sums.employerPension
    const businessName = business.trading_name || business.legal_name || business.name || business.id

    return csvResponse(payrollExportFilename("finza-payroll-summary", payrollRun), [
      [
        ...PAYROLL_EXPORT_PERIOD_HEADERS,
        "Business Name",
        "Run Status",
        "Gross Salary",
        "Regular Allowances",
        "Bonus",
        "Overtime",
        "Total PAYE",
        "Employee Pension Contribution",
        "Employer Pension Contribution",
        "Total Mandatory Pension",
        "Tier 1 / SSNIT Remittance",
        "Tier 2 Pension Remittance",
        "Other Employee Deductions",
        "Net Salary Payable",
        "Total Employer Payroll Cost",
        "Approved At",
        "Approved By",
      ],
      [
        ...payrollExportPeriodValues(payrollRun),
        String(businessName || ""),
        String(payrollRun.status || ""),
        formatNumeric(payrollRun.total_gross_salary),
        formatNumeric(sums.regularAllowances),
        formatNumeric(sums.bonus),
        formatNumeric(sums.overtime),
        formatNumeric(payrollRun.total_paye),
        formatNumeric(sums.employeePension),
        formatNumeric(sums.employerPension),
        formatNumeric(sums.totalMandatory),
        formatNumeric(sums.tier1),
        formatNumeric(sums.tier2),
        formatNumeric(payrollRun.total_deductions),
        formatNumeric(payrollRun.total_net_salary),
        formatNumeric(employerCost),
        String(payrollRun.approved_at || ""),
        String(payrollRun.approved_by || ""),
      ],
    ])
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

