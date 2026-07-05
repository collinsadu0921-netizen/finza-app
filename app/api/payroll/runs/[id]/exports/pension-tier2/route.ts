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
        basic_salary,
        pensionable_base,
        total_mandatory_pension,
        tier2_pension_remittance,
        staff:staff_id (name,ssnit_number,tin_number)
      `)
      .eq("payroll_run_id", runId)
      .order("staff(name)", { ascending: true })

    const month = String(payrollRun.payroll_month).slice(0, 7)
    const rows: string[][] = [[
      "Employee Name",
      "SSNIT Number",
      "TIN",
      "Basic Salary",
      "Pensionable Base",
      "Total Mandatory Pension 18.5%",
      "Tier 2 Pension Remittance 5%",
      "Payroll Period",
      "Tier 2 Trustee / Scheme Name",
    ]]

    for (const e of entries || []) {
      const staff = (e as any).staff || {}
      rows.push([
        String(staff.name || ""),
        String(staff.ssnit_number || ""),
        String(staff.tin_number || ""),
        formatNumeric((e as any).basic_salary),
        formatNumeric((e as any).pensionable_base),
        formatNumeric((e as any).total_mandatory_pension),
        formatNumeric((e as any).tier2_pension_remittance),
        String(payrollRun.payroll_month || ""),
        "", // TODO Phase 1C-B: capture Tier 2 trustee/scheme at business pension settings level.
      ])
    }

    return csvResponse(`finza-pension-tier2-schedule-${month}.csv`, rows)
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

