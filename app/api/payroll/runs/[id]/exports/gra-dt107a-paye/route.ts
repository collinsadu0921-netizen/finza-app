import { NextRequest, NextResponse } from "next/server"
import { csvResponse } from "@/lib/payroll/csvExport"
import {
  PAYROLL_EXPORT_PERIOD_HEADERS,
  payrollExportFilename,
  payrollExportPeriodValues,
} from "@/lib/payroll/payrollExportMetadata"
import { getAuthorizedPayrollRunForExport } from "../_shared"
import {
  GRA_DT107A_REQUIRES_APPROVAL_MESSAGE,
  buildGraDt107aPayeCsvRows,
  filterIncludedGraDt107aRows,
  isGraDt107aExportStatusAllowed,
  validateGraDt107aPayeExport,
  type GraDt107aJoinedRow,
} from "@/lib/payroll/graDt107aPayeExport"

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

    if (!isGraDt107aExportStatusAllowed(payrollRun.status)) {
      return NextResponse.json(
        { error: GRA_DT107A_REQUIRES_APPROVAL_MESSAGE, code: "GRA_EXPORT_REQUIRES_APPROVAL" },
        { status: 400 }
      )
    }

    const modeParam = request.nextUrl.searchParams.get("mode")
    const mode = modeParam === "audit" ? "audit" : "gra-ready"

    const { data: entries, error: entriesError } = await supabase
      .from("payroll_entries")
      .select(`
        is_included,
        basic_salary,
        regular_allowances_amount,
        bonus_amount,
        overtime_amount,
        gross_salary,
        employee_pension_contribution,
        ssnit_employee,
        taxable_income,
        paye,
        bonus_tax_5,
        bonus_tax_graduated,
        overtime_tax_5,
        overtime_tax_10,
        overtime_tax_graduated,
        filing_tin,
        filing_employee_name,
        bonus_concessional_amount,
        bonus_graduated_amount,
        payroll_tax_profile,
        staff:staff_id (id,name,tin_number)
      `)
      .eq("payroll_run_id", runId)
      .order("staff(name)", { ascending: true })

    if (entriesError) {
      return NextResponse.json({ error: entriesError.message }, { status: 500 })
    }

    const joined: GraDt107aJoinedRow[] = (entries || []).map((e: any) => ({
      is_included: e.is_included,
      staff: {
        id: String(e.staff?.id ?? ""),
        name: e.staff?.name ?? null,
        tin_number: e.staff?.tin_number ?? null,
      },
      entry: {
        basic_salary: e.basic_salary,
        regular_allowances_amount: e.regular_allowances_amount,
        bonus_amount: e.bonus_amount,
        overtime_amount: e.overtime_amount,
        gross_salary: e.gross_salary,
        employee_pension_contribution: e.employee_pension_contribution,
        ssnit_employee: e.ssnit_employee,
        taxable_income: e.taxable_income,
        paye: e.paye,
        bonus_tax_5: e.bonus_tax_5,
        bonus_tax_graduated: e.bonus_tax_graduated,
        overtime_tax_5: e.overtime_tax_5,
        overtime_tax_10: e.overtime_tax_10,
        overtime_tax_graduated: e.overtime_tax_graduated,
        payroll_tax_profile: e.payroll_tax_profile,
        filing_tin: e.filing_tin,
        filing_employee_name: e.filing_employee_name,
        bonus_concessional_amount: e.bonus_concessional_amount,
        bonus_graduated_amount: e.bonus_graduated_amount,
      },
    }))

    const validation = validateGraDt107aPayeExport(joined)
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: validation.message,
          issues: validation.issues,
        },
        { status: 400 }
      )
    }

    const included = filterIncludedGraDt107aRows(joined)
    const rows = buildGraDt107aPayeCsvRows(included)

    if (mode === "audit") {
      const periodMeta: string[][] = [
        ["# Pay run metadata (Finza audit export — not for GRA portal upload)"],
        [...PAYROLL_EXPORT_PERIOD_HEADERS],
        payrollExportPeriodValues(payrollRun),
        [],
      ]
      return csvResponse(
        payrollExportFilename("gra-dt107a-paye-audit", payrollRun),
        [...periodMeta, ...rows]
      )
    }

    return csvResponse(payrollExportFilename("gra-dt107a-paye-gra-ready", payrollRun), rows)
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
