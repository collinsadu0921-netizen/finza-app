/**
 * Staff-level payroll tax profile helpers (Ghana / GRA readiness).
 * Coerces DB nulls and legacy rows to resident + pensionable defaults.
 */

import type { PayrollCalculationResult } from "@/lib/payrollEngine/types"

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

type ComplianceBreakdown = NonNullable<PayrollCalculationResult["complianceBreakdown"]>

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
    is_resident: Boolean(b.isResident ?? true),
    is_pensionable: Boolean(b.pensionable ?? true),
    staff_is_tax_resident: input.staffIsTaxResident,
    staff_is_pensionable: input.staffIsPensionable,
    gra_position_code: input.graPositionCode,
    secondary_employment: input.secondaryEmployment,
    casual_worker_flat_tax_applied: Boolean(b.casualWorkerFlatTaxApplied ?? false),
    prior_bonus_paid_in_calendar_year: Number(b.priorBonusPaidInCalendarYear ?? 0),
    bonus_concessional_room_before_run: Number(b.bonusConcessionalRoomBeforeRun ?? 0),
    junior_overtime_concession_applies: Boolean(b.juniorOvertimeConcessionApplies ?? false),
    annual_qualifying_employment_income_ytd: Number(b.annualQualifyingEmploymentIncomeYtd ?? 0),
  }
}
