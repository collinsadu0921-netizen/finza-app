import { NextRequest, NextResponse } from "next/server"
import { csvResponse, formatNumeric } from "@/lib/payroll/csvExport"
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
        staff_id,
        basic_salary,
        regular_allowances_amount,
        bonus_amount,
        overtime_amount,
        gross_salary,
        employee_pension_contribution,
        ssnit_employee,
        taxable_income,
        paye,
        net_salary,
        payroll_tax_profile,
        staff:staff_id (id,name,tin_number,ssnit_number,employment_type)
      `)
      .eq("payroll_run_id", runId)
      .order("staff(name)", { ascending: true })

    const month = String(payrollRun.payroll_month).slice(0, 7)
    const rows: string[][] = [[
      "Employee Name",
      "Staff ID",
      "TIN",
      "SSNIT Number",
      "Basic Salary",
      "Regular Allowances",
      "Bonus",
      "Overtime",
      "Gross Pay",
      "Employee Pension Contribution",
      "Taxable Income",
      "PAYE Withheld",
      "Net Pay",
      "Employment Category",
      "Resident Status",
      "Payroll Period",
    ]]

    for (const e of entries || []) {
      const staff = (e as any).staff || {}
      const profile = (e as any).payroll_tax_profile || {}
      rows.push([
        String(staff.name || ""),
        String(staff.id || ""),
        String(staff.tin_number || ""),
        String(staff.ssnit_number || ""),
        formatNumeric((e as any).basic_salary),
        formatNumeric((e as any).regular_allowances_amount),
        formatNumeric((e as any).bonus_amount),
        formatNumeric((e as any).overtime_amount),
        formatNumeric((e as any).gross_salary),
        formatNumeric((e as any).employee_pension_contribution ?? (e as any).ssnit_employee),
        formatNumeric((e as any).taxable_income),
        formatNumeric((e as any).paye),
        formatNumeric((e as any).net_salary),
        String(staff.employment_type || ""),
        profile?.is_resident === true ? "Resident" : profile?.is_resident === false ? "Non-resident" : "Not captured",
        String(payrollRun.payroll_month || ""),
      ])
    }

    return csvResponse(`finza-paye-schedule-${month}.csv`, rows)
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

