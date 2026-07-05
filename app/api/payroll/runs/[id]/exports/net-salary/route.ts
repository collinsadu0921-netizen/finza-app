import { NextRequest, NextResponse } from "next/server"
import { csvResponse, formatNumeric } from "@/lib/payroll/csvExport"
import { getAuthorizedPayrollRunForExport } from "../_shared"

function staffPayoutFields(staff: {
  bank_name?: string | null
  bank_account?: string | null
  phone?: string | null
}) {
  return {
    bankName: String(staff.bank_name ?? "").trim(),
    bankAccountNumber: String(staff.bank_account ?? "").trim(),
    accountName: "",
    momoProvider: "",
    momoNumber: String(staff.phone ?? "").trim(),
  }
}

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
        gross_salary,
        paye,
        employee_pension_contribution,
        ssnit_employee,
        deductions_total,
        net_salary,
        is_included,
        staff:staff_id (id,name,bank_name,bank_account,phone)
      `)
      .eq("payroll_run_id", runId)
      .order("staff(name)", { ascending: true })

    const month = String(payrollRun.payroll_month).slice(0, 7)
    const rows: string[][] = [
      [
        "Employee Name",
        "Bank Name",
        "Bank Account Number",
        "Account Name",
        "MoMo Provider",
        "MoMo Number",
        "Gross Pay",
        "PAYE",
        "Employee Pension Contribution",
        "Other Deductions",
        "Net Pay",
        "Payroll Period",
      ],
    ]

    for (const e of entries || []) {
      if ((e as { is_included?: boolean }).is_included === false) continue

      const rawStaff = (e as { staff?: unknown }).staff
      let staffRecord: Record<string, unknown> = {}
      if (rawStaff != null) {
        const embedded = Array.isArray(rawStaff) ? rawStaff[0] : rawStaff
        if (embedded && typeof embedded === "object") {
          staffRecord = embedded as Record<string, unknown>
        }
      }
      const payout = staffPayoutFields({
        bank_name: staffRecord.bank_name as string | null | undefined,
        bank_account: staffRecord.bank_account as string | null | undefined,
        phone: staffRecord.phone as string | null | undefined,
      })
      rows.push([
        String(staffRecord.name || ""),
        payout.bankName,
        payout.bankAccountNumber,
        payout.accountName,
        payout.momoProvider,
        payout.momoNumber,
        formatNumeric((e as { gross_salary?: unknown }).gross_salary),
        formatNumeric((e as { paye?: unknown }).paye),
        formatNumeric(
          (e as { employee_pension_contribution?: unknown }).employee_pension_contribution ??
            (e as { ssnit_employee?: unknown }).ssnit_employee
        ),
        formatNumeric((e as { deductions_total?: unknown }).deductions_total),
        formatNumeric((e as { net_salary?: unknown }).net_salary),
        String(payrollRun.payroll_month || ""),
      ])
    }

    return csvResponse(`finza-net-salary-schedule-${month}.csv`, rows)
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
