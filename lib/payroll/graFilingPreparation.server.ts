import "server-only"

import { createHash } from "crypto"
import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { payrollExportFilename } from "@/lib/payroll/payrollExportMetadata"
import { rawCsvResponse, rowsToCsv } from "@/lib/payroll/exportSnapshotDownload"
import {
  buildGraDt107aPayeCsvRows,
  filterIncludedGraDt107aRows,
  validateGraDt107aPayeExport,
  type GraDt107aJoinedRow,
} from "@/lib/payroll/graDt107aPayeExport"

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

/**
 * Build a GRA DT 107A preparation export from approved payroll amounts plus the
 * current employee/business filing identity. Used only when no approval-time
 * DT 107A snapshot exists. Does not alter approved calculations or snapshots.
 */
export async function buildLateGraFilingPreparation(input: {
  supabase: Awaited<ReturnType<typeof import("@/lib/supabaseServer").createSupabaseServerClient>>
  payrollRun: Record<string, unknown>
  actorId: string | null
}): Promise<NextResponse> {
  const { supabase, payrollRun, actorId } = input
  const businessId = String(payrollRun.business_id ?? "")
  const runId = String(payrollRun.id ?? "")

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, tin")
    .eq("id", businessId)
    .maybeSingle()

  if (businessError || !business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 })
  }
  const businessTin = String(business.tin ?? "").trim()

  const { data: entries, error: entriesError } = await supabase
    .from("payroll_entries")
    .select(`
      *,
      staff:staff_id (
        id,
        name,
        tin_number,
        gra_position_code
      )
    `)
    .eq("payroll_run_id", runId)
    .order("staff_id", { ascending: true })

  if (entriesError) {
    return NextResponse.json({ error: entriesError.message }, { status: 500 })
  }

  const joined: GraDt107aJoinedRow[] = (entries || []).map((raw: Record<string, unknown>) => {
    const staff = Array.isArray(raw.staff) ? raw.staff[0] : raw.staff
    return {
      is_included: raw.is_included as boolean | null | undefined,
      staff: {
        id: String((staff as { id?: string } | null)?.id ?? raw.staff_id ?? ""),
        name: (staff as { name?: string | null } | null)?.name ?? null,
        tin_number: (staff as { tin_number?: string | null } | null)?.tin_number ?? null,
        gra_position_code:
          (staff as { gra_position_code?: string | null } | null)?.gra_position_code ?? null,
      },
      entry: {
        basic_salary: raw.basic_salary as number | null,
        regular_allowances_amount: raw.regular_allowances_amount as number | null,
        bonus_amount: raw.bonus_amount as number | null,
        overtime_amount: raw.overtime_amount as number | null,
        gross_salary: raw.gross_salary as number | null,
        employee_pension_contribution: raw.employee_pension_contribution as number | null,
        ssnit_employee: raw.ssnit_employee as number | null,
        taxable_income: raw.taxable_income as number | null,
        paye: raw.paye as number | null,
        bonus_tax_5: raw.bonus_tax_5 as number | null,
        bonus_tax_graduated: raw.bonus_tax_graduated as number | null,
        overtime_tax_5: raw.overtime_tax_5 as number | null,
        overtime_tax_10: raw.overtime_tax_10 as number | null,
        overtime_tax_graduated: raw.overtime_tax_graduated as number | null,
        payroll_tax_profile: raw.payroll_tax_profile as Record<string, unknown> | null,
        filing_tin: raw.filing_tin as string | null,
        filing_employee_name: raw.filing_employee_name as string | null,
        bonus_concessional_amount: raw.bonus_concessional_amount as number | null,
        bonus_graduated_amount: raw.bonus_graduated_amount as number | null,
      },
    }
  })

  const filingOptions = { allowLiveStaffFallback: true } as const
  const validation = validateGraDt107aPayeExport(joined, filingOptions)
  if (!businessTin || !validation.ok) {
    const validationMessage = validation.ok ? "" : validation.message
    return NextResponse.json(
      {
        error: !businessTin
          ? "Add the business TIN in Company Settings before preparing the GRA DT 107A return."
          : validationMessage,
        code: "GRA_FILING_DETAILS_REQUIRED",
        business_tin_missing: !businessTin,
        issues: validation.ok ? [] : validation.issues,
      },
      { status: 400 }
    )
  }

  const csvRows = buildGraDt107aPayeCsvRows(joined, filingOptions)
  const content = rowsToCsv(csvRows)
  const contentSha256 = sha256(content)
  const included = filterIncludedGraDt107aRows(joined)
  const identityPayload = {
    business_tin: businessTin,
    employees: included.map((row) => ({
      staff_id: row.staff.id,
      name: row.staff.name,
      filing_tin: row.entry.filing_tin ?? row.staff.tin_number ?? null,
      gra_position_code:
        row.entry.payroll_tax_profile?.gra_position_code ?? row.staff.gra_position_code ?? null,
    })),
  }
  const identitySha256 = sha256(JSON.stringify(identityPayload))

  const admin = createSupabaseAdminClient()
  const { error: auditError } = await admin.from("payroll_filing_preparations").upsert(
    {
      business_id: businessId,
      payroll_run_id: runId,
      export_type: "gra_dt107a",
      prepared_by: actorId,
      business_tin: businessTin,
      identity_payload: identityPayload,
      identity_sha256: identitySha256,
      row_count: included.length,
      content_sha256: contentSha256,
      content,
    },
    {
      onConflict: "business_id,payroll_run_id,export_type,content_sha256",
      ignoreDuplicates: true,
    }
  )

  if (auditError) {
    console.error("[gra filing preparation] audit insert", auditError)
    return NextResponse.json(
      { error: "Could not record the filing preparation audit entry." },
      { status: 500 }
    )
  }

  return rawCsvResponse(
    payrollExportFilename("gra-dt107a-paye-preparation", payrollRun),
    content
  )
}
