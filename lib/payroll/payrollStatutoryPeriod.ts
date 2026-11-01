import { toCalendarDate } from "@/lib/payrollEngine/versioning"
import { monthBoundsFromAnchor } from "./payrollPeriodUtils"

/**
 * Fields that can carry a payroll run's intended statutory period.
 *
 * `statutory_period_basis` and `pay_period_start` are DATE columns and are the
 * authoritative calendar dates. `payroll_month` is only a legacy fallback and
 * must never override them, because an imported/legacy value can be a
 * timezone-shifted timestamp whose literal date is the previous day.
 */
export type PayrollStatutoryPeriodSource = {
  statutory_period_basis?: string | null
  pay_period_start?: string | null
  pay_period_end?: string | null
  payroll_month?: string | null
  payroll_frequency?: string | null
}

function optionalCalendarDate(value: unknown): string | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  try {
    return toCalendarDate(raw)
  } catch {
    return null
  }
}

/**
 * Resolve the date used to select PAYE and SSNIT versions for a run.
 *
 * Priority:
 * 1. `statutory_period_basis` (stored per-run statutory period)
 * 2. `pay_period_start` (authoritative pay-period start)
 * 3. `payroll_month` (legacy fallback only)
 *
 * Monthly periods are anchored to the first day of their month so the selected
 * statutory version cannot depend on the day-of-month chosen by the operator.
 * Returns null when no usable calendar date exists; callers must fail safely.
 */
export function resolveRunStatutoryPeriodDate(
  run: PayrollStatutoryPeriodSource
): string | null {
  const frequency = String(run.payroll_frequency || "monthly").toLowerCase()
  const monthly = frequency === "monthly"

  const basis = optionalCalendarDate(run.statutory_period_basis)
  if (basis) return basis

  const periodStart = optionalCalendarDate(run.pay_period_start)
  if (periodStart) return monthly ? monthBoundsFromAnchor(periodStart).start : periodStart

  const legacyMonth = optionalCalendarDate(run.payroll_month)
  if (legacyMonth) return monthly ? monthBoundsFromAnchor(legacyMonth).start : legacyMonth

  return null
}
