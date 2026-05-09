import { NextRequest, NextResponse } from "next/server"
import { csvResponse, formatNumeric } from "@/lib/payroll/csvExport"
import { getAuthorizedPayrollRunForExport } from "../_shared"
import { resolveNetSalaryExportPayoutFields } from "@/lib/staffPaymentMethods"

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
        staff:staff_id (id,name,bank_name,bank_account,phone)
      `)
      .eq("payroll_run_id", runId)
      .order("staff(name)", { ascending: true })

    const staffIds = Array.from(
      new Set(
        (entries || [])
          .map((e) => String((e as { staff?: { id?: string } }).staff?.id || "").trim())
          .filter(Boolean)
      )
    )

    const defaultMethodByStaffId = new Map<
      string,
      {
        method_type: string
        bank_name?: string | null
        account_number?: string | null
        account_name?: string | null
        momo_provider?: string | null
        momo_number?: string | null
      }
    >()

    if (staffIds.length > 0) {
      const { data: defaultRows } = await supabase
        .from("staff_payment_methods")
        .select(
          "staff_id, method_type, bank_name, account_number, account_name, momo_provider, momo_number"
        )
        .eq("business_id", payrollRun.business_id)
        .in("staff_id", staffIds)
        .eq("is_default", true)
        .is("deleted_at", null)

      for (const row of defaultRows || []) {
        const r = row as {
          staff_id: string
          method_type: string
          bank_name?: string | null
          account_number?: string | null
          account_name?: string | null
          momo_provider?: string | null
          momo_number?: string | null
        }
        defaultMethodByStaffId.set(String(r.staff_id), {
          method_type: r.method_type,
          bank_name: r.bank_name,
          account_number: r.account_number,
          account_name: r.account_name,
          momo_provider: r.momo_provider,
          momo_number: r.momo_number,
        })
      }
    }

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
      const rawStaff = (e as { staff?: unknown }).staff
      let staffRecord: Record<string, unknown> = {}
      if (rawStaff != null) {
        const embedded = Array.isArray(rawStaff) ? rawStaff[0] : rawStaff
        if (embedded && typeof embedded === "object") {
          staffRecord = embedded as Record<string, unknown>
        }
      }
      const staffId = String(staffRecord.id || "")
      const payout = resolveNetSalaryExportPayoutFields(
        {
          bank_name: staffRecord.bank_name as string | null | undefined,
          bank_account: staffRecord.bank_account as string | null | undefined,
          phone: staffRecord.phone as string | null | undefined,
        },
        staffId ? defaultMethodByStaffId.get(staffId) ?? null : null
      )
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
