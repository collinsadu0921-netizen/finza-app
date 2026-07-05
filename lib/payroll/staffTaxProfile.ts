/**
 * Staff-level payroll tax profile helpers (Ghana / GRA readiness).
 * Coerces DB nulls and legacy rows to resident + pensionable defaults.
 */

import { roundPayroll } from "@/lib/payrollEngine/versioning"

export const GRA_POSITION_CODES = ["EXPT", "JUNR", "MNGT", "OTHR", "SENR"] as const
export type GraPositionCode = (typeof GRA_POSITION_CODES)[number]

const GRA_SET = new Set<string>(GRA_POSITION_CODES)

/** Tax resident unless explicitly false (matches NOT NULL DEFAULT true on staff). */
export function parseStaffIsTaxResident(value: unknown): boolean {
  return value !== false
}

/** Pensionable unless explicitly false. */
export function parseStaffIsPensionable(value: unknown): boolean {
  return value !== false
}

/** Returns null for blank/invalid; uppercase valid codes. */
export function normalizeGraPositionCode(value: unknown): GraPositionCode | null {
  if (value == null) return null
  const s = String(value).trim().toUpperCase()
  if (!s) return null
  return GRA_SET.has(s) ? (s as GraPositionCode) : null
}

export function parseStaffSecondaryEmployment(value: unknown): boolean {
  return value === true
}

export type StaffFilingProfileInput = {
  name?: string | null
  tin_number?: string | null
  is_tax_resident?: unknown
  is_pensionable?: unknown
  gra_position_code?: unknown
  secondary_employment?: unknown
}

export type GraFilingFieldsForPayrollEntry = {
  payroll_tax_profile: Record<string, unknown>
  filing_tin: string | null
  filing_employee_name: string | null
  bonus_concessional_amount: number
  bonus_graduated_amount: number
}

type ComplianceBreakdown = Record<string, unknown>

function snapshotText(value: unknown): string | null {
  const s = String(value ?? "").trim()
  return s || null
}

/** Bonus split for GRA filing columns — derived from engine breakdown already on the entry. */
export function deriveBonusFilingAmounts(
  breakdown: ComplianceBreakdown | null | undefined
): Pick<GraFilingFieldsForPayrollEntry, "bonus_concessional_amount" | "bonus_graduated_amount"> {
  const b = breakdown ?? {}
  const bonusAmount = breakdownNum(b, "bonusAmount", 0)
  if (bonusAmount <= 0) {
    return { bonus_concessional_amount: 0, bonus_graduated_amount: 0 }
  }
  const bonusCap = breakdownNum(b, "bonusCapAmount", 0)
  const concessional = roundPayroll(Math.min(bonusAmount, Math.max(0, bonusCap)))
  const graduated = roundPayroll(Math.max(0, bonusAmount - concessional))
  return { bonus_concessional_amount: concessional, bonus_graduated_amount: graduated }
}

function breakdownBool(b: ComplianceBreakdown, key: string, fallback = false): boolean {
  const v = b[key]
  return v === undefined ? fallback : Boolean(v)
}

function breakdownNum(b: ComplianceBreakdown, key: string, fallback = 0): number {
  const v = b[key]
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** Snapshot JSON stored on payroll_entries.payroll_tax_profile (run creation). */
export function buildPayrollTaxProfileSnapshotForEntry(input: {
  breakdown: ComplianceBreakdown
  staffIsTaxResident: boolean
  staffIsPensionable: boolean
  graPositionCode: string | null
  secondaryEmployment: boolean
}): Record<string, unknown> {
  const b = input.breakdown
  return {
    is_resident: breakdownBool(b, "isResident", true),
    is_pensionable: breakdownBool(b, "pensionable", true),
    staff_is_tax_resident: input.staffIsTaxResident,
    staff_is_pensionable: input.staffIsPensionable,
    gra_position_code: input.graPositionCode,
    secondary_employment: input.secondaryEmployment,
    casual_worker_flat_tax_applied: breakdownBool(b, "casualWorkerFlatTaxApplied"),
    prior_bonus_paid_in_calendar_year: breakdownNum(b, "priorBonusPaidInCalendarYear"),
    bonus_concessional_room_before_run: breakdownNum(b, "bonusConcessionalRoomBeforeRun"),
    junior_overtime_concession_applies: breakdownBool(b, "juniorOvertimeConcessionApplies"),
    annual_qualifying_employment_income_ytd: breakdownNum(b, "annualQualifyingEmploymentIncomeYtd"),
  }
}

/** GRA filing snapshots persisted on payroll_entries at run creation (Phase 2A). */
export function buildGraFilingFieldsForPayrollEntry(input: {
  staff: StaffFilingProfileInput
  breakdown?: ComplianceBreakdown | null
}): GraFilingFieldsForPayrollEntry {
  const breakdown = input.breakdown ?? {}
  return {
    payroll_tax_profile: buildPayrollTaxProfileSnapshotForEntry({
      breakdown,
      staffIsTaxResident: parseStaffIsTaxResident(input.staff.is_tax_resident),
      staffIsPensionable: parseStaffIsPensionable(input.staff.is_pensionable),
      graPositionCode: normalizeGraPositionCode(input.staff.gra_position_code),
      secondaryEmployment: parseStaffSecondaryEmployment(input.staff.secondary_employment),
    }),
    filing_tin: snapshotText(input.staff.tin_number),
    filing_employee_name: snapshotText(input.staff.name),
    ...deriveBonusFilingAmounts(breakdown),
  }
}
