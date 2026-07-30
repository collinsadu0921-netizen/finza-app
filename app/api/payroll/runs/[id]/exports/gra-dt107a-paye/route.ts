import { NextRequest, NextResponse } from "next/server"
import {
  buildDt107aAuditMetadataLines,
  rawCsvResponse,
  rowsToCsv,
  type PayrollExportSnapshotRow,
} from "@/lib/payroll/exportSnapshotDownload"
import { payrollExportFilename } from "@/lib/payroll/payrollExportMetadata"
import {
  GRA_DT107A_REQUIRES_APPROVAL_MESSAGE,
  buildGraDt107aPayeCsvRows,
  isGraDt107aExportStatusAllowed,
  validateGraDt107aPayeExport,
  type GraDt107aJoinedRow,
} from "@/lib/payroll/graDt107aPayeExport"
import {
  getAuthorizedPayrollRunForExport,
  isImmutablePayrollRunStatus,
  resolveExportMode,
  serveImmutablePayrollExport,
} from "../_shared"

const SNAPSHOT_ONLY_FILING = { allowLiveStaffFallback: false } as const

async function buildLegacyDt107aAuditExport(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabaseServer").createSupabaseServerClient>>,
  runId: string,
  payrollRun: Record<string, unknown>
): Promise<NextResponse | null> {
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
      staff_id
    `)
    .eq("payroll_run_id", runId)
    .order("staff_id", { ascending: true })

  if (entriesError) {
    return NextResponse.json({ error: entriesError.message }, { status: 500 })
  }

  const joined: GraDt107aJoinedRow[] = (entries || []).map((e: Record<string, unknown>) => ({
    is_included: e.is_included as boolean | null | undefined,
    staff: {
      id: String(e.staff_id ?? ""),
      name: null,
      tin_number: null,
    },
    entry: {
      basic_salary: e.basic_salary as number | null,
      regular_allowances_amount: e.regular_allowances_amount as number | null,
      bonus_amount: e.bonus_amount as number | null,
      overtime_amount: e.overtime_amount as number | null,
      gross_salary: e.gross_salary as number | null,
      employee_pension_contribution: e.employee_pension_contribution as number | null,
      ssnit_employee: e.ssnit_employee as number | null,
      taxable_income: e.taxable_income as number | null,
      paye: e.paye as number | null,
      bonus_tax_5: e.bonus_tax_5 as number | null,
      bonus_tax_graduated: e.bonus_tax_graduated as number | null,
      overtime_tax_5: e.overtime_tax_5 as number | null,
      overtime_tax_10: e.overtime_tax_10 as number | null,
      overtime_tax_graduated: e.overtime_tax_graduated as number | null,
      payroll_tax_profile: e.payroll_tax_profile as Record<string, unknown> | null,
      filing_tin: e.filing_tin as string | null | undefined,
      filing_employee_name: e.filing_employee_name as string | null | undefined,
      bonus_concessional_amount: e.bonus_concessional_amount as number | null | undefined,
      bonus_graduated_amount: e.bonus_graduated_amount as number | null | undefined,
    },
  }))

  const validation = validateGraDt107aPayeExport(joined, SNAPSHOT_ONLY_FILING)
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: validation.message,
        issues: validation.issues,
        code: "PAYROLL_EXPORT_LEGACY_SNAPSHOT_MISSING",
      },
      { status: 400 }
    )
  }

  const tableRows = buildGraDt107aPayeCsvRows(joined, SNAPSHOT_ONLY_FILING)
  const tableContent = rowsToCsv(tableRows)
  const pseudoSnapshot: PayrollExportSnapshotRow = {
    id: "legacy-audit",
    business_id: String(payrollRun.business_id ?? ""),
    payroll_run_id: runId,
    export_type: "gra_dt107a",
    snapshot_schema_version: "legacy-audit",
    renderer_version: "gra-dt107a-renderer-v1",
    template_version: null,
    template_reference: null,
    source_run_status: String(payrollRun.status ?? ""),
    source_payload: { run: payrollRun },
    source_payload_sha256: "",
    row_count: tableRows.length - 1,
    control_totals: {},
    rendered_content: tableContent,
    rendered_content_sha256: null,
    content_type: "text/csv",
    filename: null,
    materialized_at: null,
    created_at: new Date().toISOString(),
    created_by: null,
  }

  const metaLines = buildDt107aAuditMetadataLines(pseudoSnapshot, payrollRun)
  metaLines.unshift(["# LEGACY EXPORT — NO APPROVAL-TIME SNAPSHOT"], [])
  const auditCsv = rowsToCsv(metaLines) + tableContent
  const filename = payrollExportFilename("gra-dt107a-paye-audit", payrollRun)
  return rawCsvResponse(filename, auditCsv)
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

    const mode = resolveExportMode(request)

    if (!isGraDt107aExportStatusAllowed(payrollRun.status, mode)) {
      return NextResponse.json(
        { error: GRA_DT107A_REQUIRES_APPROVAL_MESSAGE, code: "GRA_EXPORT_REQUIRES_APPROVAL" },
        { status: 400 }
      )
    }

    if (!isImmutablePayrollRunStatus(payrollRun.status)) {
      return NextResponse.json(
        { error: GRA_DT107A_REQUIRES_APPROVAL_MESSAGE, code: "GRA_EXPORT_REQUIRES_APPROVAL" },
        { status: 400 }
      )
    }

    return serveImmutablePayrollExport({
      supabase,
      business: { id: payrollRun.business_id },
      payrollRun,
      exportType: "gra_dt107a",
      mode,
      filenamePrefix: mode === "audit" ? "gra-dt107a-paye-audit" : "gra-dt107a-paye-preparation",
      legacyAuditContent: async () => {
        if (mode !== "audit") return null
        return buildLegacyDt107aAuditExport(supabase, runId, payrollRun)
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
