/**
 * GRA DT 107A — Monthly PAYE upload CSV (Phase 1 / 1B + Phase 2A filing integrity).
 *
 * Column titles and order match GRA **DT 0107A uploadable monthly PAYE employee format v1**
 * (`TABLE DATA` row). Maintainer reference copies may exist under `.local/gra-paye-templates/` — **never**
 * read that path from app or export code; headers stay defined here only.
 * This is not statutory certification; employers must verify against current GRA guidance.
 *
 * Phase 2A (filing integrity, no PAYE math change):
 * - `filing_tin` / `filing_employee_name` on `payroll_entries`: frozen at payroll run creation for this export;
 *   legacy rows fall back to live `staff` values.
 * - `bonus_graduated_amount` on `payroll_entries`: engine snapshot for column (13) Excess Bonus; legacy rows
 *   fall back to profile-based derivation. Third-tier / benefits / reliefs / severance remain Phase 2B/2C.
 *
 * Mapping notes (Phase 1B):
 * - Social Security Fund (8): Finza uses the employee pension withholding stored on the payroll entry
 *   (`employee_pension_contribution` or legacy `ssnit_employee`) — the employee share of mandatory pension
 *   (e.g. Ghana 5.5% of insurable basic). **Confirm column meaning with GRA** if not already documented
 *   for your filing context.
 * - Total Cash Emolument (14): Finza `gross_salary` (= basic + regular cash allowances + bonus + overtime
 *   as computed at payroll run). No non-cash elements in Phase 1.
 * - Total Assessable Income (18): Phase 1 — equals (14) because accommodation/vehicle/non-cash are 0.00.
 * - Excess Bonus (13): Prefer `payroll_entries.bonus_graduated_amount` (engine snapshot at run creation).
 *   Legacy fallback: `payroll_tax_profile` concessional room + casual flag (same as pre–Phase 2A).
 * - Tax Deductible (22) & Total Tax Payable to GRA (25): both use stored `paye` on the payroll entry
 *   (per product spec for this phase). **Confirm both columns with GRA** if their template distinguishes
 *   withholding vs remittance totals.
 * - Remarks (27): left blank unless we add row-specific flags later (keep upload CSV clean).
 */

import { formatNumeric } from "@/lib/payroll/csvExport"
import { roundPayroll } from "@/lib/payrollEngine/versioning"

/** Exact header row for GRA DT 0107A uploadable monthly CSV (27 columns; TABLE DATA row). */
export const GRA_DT107A_PAYE_HEADER_ROW: readonly string[] = [
  "(3) TIN",
  "(2) Employee Name",
  "(1) Serial Number",
  "(4) Position",
  "(5) Non-Resident",
  "(6) Basic Salary",
  "(7) Secondary Employment",
  "(8) Social Security Fund",
  "(9) Third Tier Pension",
  "(10) Cash Allowances",
  "(11) Bonus Income",
  "(12) Final Tax on Bonus",
  "(13) Excess Bonus",
  "(14) Total Cash Emolument",
  "(15) Accommodation Element",
  "(16) Vehicle Element",
  "(17) Non Cash Benefit",
  "(18) Total Assessable Income",
  "(19) Deductible Reliefs",
  "(20) Total Reliefs",
  "(21) Chargeable Income",
  "(22) Tax Deductible",
  "(23) Overtime Income",
  "(24) Overtime Tax",
  "(25) Total Tax Payable to GRA",
  "(26) Severance Pay Paid",
  "(27) Remarks ",
] as const

export const GRA_DT107A_ALLOWED_POSITIONS = new Set(["EXPT", "JUNR", "MNGT", "OTHR", "SENR"])

export type GraDt107aStaffRow = {
  id: string
  name: string | null
  tin_number: string | null
}

export type GraDt107aPayrollEntryRow = {
  basic_salary: number | null
  regular_allowances_amount: number | null
  bonus_amount: number | null
  overtime_amount: number | null
  gross_salary: number | null
  employee_pension_contribution: number | null
  ssnit_employee: number | null
  taxable_income: number | null
  paye: number | null
  bonus_tax_5: number | null
  bonus_tax_graduated: number | null
  overtime_tax_5: number | null
  overtime_tax_10: number | null
  overtime_tax_graduated: number | null
  payroll_tax_profile: Record<string, unknown> | null
  /** Frozen TIN at run creation (Phase 2A). Null = legacy row → use staff.tin_number for export/validation. */
  filing_tin?: string | null
  /** Frozen display name at run creation (Phase 2A). Null = legacy → use staff.name. */
  filing_employee_name?: string | null
  /** Ghana engine snapshot; optional audit trail (Phase 2A). */
  bonus_concessional_amount?: number | null
  /** Ghana engine excess bonus slice for GRA (13); null = legacy → derive from profile or 0. */
  bonus_graduated_amount?: number | null
}

export type GraDt107aJoinedRow = {
  staff: GraDt107aStaffRow
  entry: GraDt107aPayrollEntryRow
}

export type GraDt107aValidationIssue = {
  staff_id: string
  staff_name: string
  missing_fields: ("tin" | "gra_position_code")[]
}

/** Y = non-resident, N = resident (per GRA schedule convention for this export). */
export function graNonResidentYN(profile: Record<string, unknown> | null): "Y" | "N" {
  const p = profile || {}
  if (p.staff_is_tax_resident === false) return "Y"
  if (p.staff_is_tax_resident === true) return "N"
  if (p.is_resident === false) return "Y"
  if (p.is_resident === true) return "N"
  return "N"
}

export function graSecondaryEmploymentYN(profile: Record<string, unknown> | null): "Y" | "N" {
  const p = profile || {}
  return p.secondary_employment === true ? "Y" : "N"
}

export function parsePayrollTaxProfile(raw: unknown): Record<string, unknown> | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

/** Effective TIN for GRA validation and column (3): filing snapshot first, then live staff (legacy). */
export function effectiveFilingTin(staff: GraDt107aStaffRow, entry: GraDt107aPayrollEntryRow): string {
  if (entry.filing_tin != null) return String(entry.filing_tin).trim()
  return String(staff.tin_number ?? "").trim()
}

/** Effective employee name for column (2): filing snapshot first, then live staff (legacy). */
export function effectiveFilingEmployeeName(staff: GraDt107aStaffRow, entry: GraDt107aPayrollEntryRow): string {
  if (entry.filing_employee_name != null) return String(entry.filing_employee_name).trim()
  return String(staff.name ?? "").trim()
}

export function employeeSocialSecurityFundAmount(entry: GraDt107aPayrollEntryRow): number {
  const a = Number(entry.employee_pension_contribution ?? entry.ssnit_employee ?? 0)
  return Number.isFinite(a) ? a : 0
}

export function overtimeTaxTotal(entry: GraDt107aPayrollEntryRow): number {
  const a =
    Number(entry.overtime_tax_5 ?? 0) +
    Number(entry.overtime_tax_10 ?? 0) +
    Number(entry.overtime_tax_graduated ?? 0)
  return Number.isFinite(a) ? a : 0
}

/**
 * Ghana bonus amount above the monthly concessional room (legacy export fallback only).
 * Same split as engine `bonusGraduatedAmount`, derived from `bonus_amount` + `payroll_tax_profile` —
 * **no** annual cap math here. Prefer `payroll_entries.bonus_graduated_amount` via `graDt107aExcessBonusForExport`.
 */
export function graDt107aExcessBonusAmount(
  entry: GraDt107aPayrollEntryRow,
  profile: Record<string, unknown>
): number {
  const b = roundPayroll(Math.max(0, Number(entry.bonus_amount ?? 0) || 0))
  if (b <= 0) return 0

  if (profile.casual_worker_flat_tax_applied === true) {
    return roundPayroll(b)
  }

  const rawRoom = profile.bonus_concessional_room_before_run
  if (rawRoom == null) return 0
  const room = Number(rawRoom)
  if (!Number.isFinite(room)) return 0

  const roomNonNeg = roundPayroll(Math.max(0, room))
  const concessional = roundPayroll(Math.min(b, roomNonNeg))
  return roundPayroll(Math.max(0, b - concessional))
}

/** Column (13): engine snapshot when present; else legacy `graDt107aExcessBonusAmount`. */
export function graDt107aExcessBonusForExport(entry: GraDt107aPayrollEntryRow, profile: Record<string, unknown>): number {
  const stored = entry.bonus_graduated_amount
  if (stored != null && Number.isFinite(Number(stored))) {
    return roundPayroll(Math.max(0, Number(stored)))
  }
  return graDt107aExcessBonusAmount(entry, profile)
}

export function totalCashEmolument(entry: GraDt107aPayrollEntryRow): number {
  const g = Number(entry.gross_salary ?? 0)
  return Number.isFinite(g) ? g : 0
}

export function totalAssessableIncomePhase1(entry: GraDt107aPayrollEntryRow): number {
  return totalCashEmolument(entry)
}

export function validateGraDt107aPayeExport(rows: GraDt107aJoinedRow[]): {
  ok: true
} | {
  ok: false
  message: string
  issues: GraDt107aValidationIssue[]
} {
  if (!rows.length) {
    return {
      ok: false,
      message: "This payroll run has no entries to export.",
      issues: [],
    }
  }

  const issues: GraDt107aValidationIssue[] = []

  for (const { staff, entry } of rows) {
    const tin = effectiveFilingTin(staff, entry)
    const profile = parsePayrollTaxProfile(entry.payroll_tax_profile)
    const rawPos = profile?.gra_position_code
    const pos = typeof rawPos === "string" ? rawPos.trim().toUpperCase() : ""
    const missing: GraDt107aValidationIssue["missing_fields"] = []
    if (!tin) missing.push("tin")
    if (!pos || !GRA_DT107A_ALLOWED_POSITIONS.has(pos)) missing.push("gra_position_code")
    if (missing.length) {
      issues.push({
        staff_id: String(staff.id),
        staff_name: effectiveFilingEmployeeName(staff, entry) || "Unknown",
        missing_fields: missing,
      })
    }
  }

  if (issues.length) {
    const lines = issues.map(
      (i) =>
        `${i.staff_name} (${i.staff_id}): missing ${i.missing_fields.join(", ").replace(/_/g, " ")}`
    )
    return {
      ok: false,
      message: `GRA DT 107A export blocked: every employee must have a TIN and a GRA position code on the payroll snapshot. Issues:\n${lines.join("\n")}`,
      issues,
    }
  }

  return { ok: true }
}

export function buildGraDt107aPayeDataRows(rows: GraDt107aJoinedRow[]): string[][] {
  const out: string[][] = []
  let serial = 1
  for (const { staff, entry } of rows) {
    const profile = parsePayrollTaxProfile(entry.payroll_tax_profile) || {}
    const pos = String(profile.gra_position_code ?? "").trim().toUpperCase()
    const ssf = employeeSocialSecurityFundAmount(entry)
    const otTax = overtimeTaxTotal(entry)
    const cashEmolument = totalCashEmolument(entry)
    const assessable = totalAssessableIncomePhase1(entry)
    const chargeable = Number(entry.taxable_income ?? 0)
    const paye = Number(entry.paye ?? 0)
    const excessBonus = graDt107aExcessBonusForExport(entry, profile)

    out.push([
      effectiveFilingTin(staff, entry),
      effectiveFilingEmployeeName(staff, entry),
      String(serial),
      pos,
      graNonResidentYN(profile),
      formatNumeric(entry.basic_salary),
      graSecondaryEmploymentYN(profile),
      formatNumeric(ssf),
      formatNumeric(0),
      formatNumeric(entry.regular_allowances_amount),
      formatNumeric(entry.bonus_amount),
      formatNumeric(entry.bonus_tax_5),
      formatNumeric(excessBonus),
      formatNumeric(cashEmolument),
      formatNumeric(0),
      formatNumeric(0),
      formatNumeric(0),
      formatNumeric(assessable),
      formatNumeric(0),
      formatNumeric(0),
      formatNumeric(chargeable),
      formatNumeric(paye),
      formatNumeric(entry.overtime_amount),
      formatNumeric(otTax),
      formatNumeric(paye),
      formatNumeric(0),
      "",
    ])
    serial += 1
  }
  return out
}

export function buildGraDt107aPayeCsvRows(rows: GraDt107aJoinedRow[]): string[][] {
  return [[...GRA_DT107A_PAYE_HEADER_ROW], ...buildGraDt107aPayeDataRows(rows)]
}
