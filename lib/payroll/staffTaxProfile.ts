/**
 * Staff-level payroll tax profile helpers (Ghana / GRA readiness).
 * Coerces DB nulls and legacy rows to resident + pensionable defaults.
 */

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

type ComplianceBreakdown = Record<string, unknown>

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
