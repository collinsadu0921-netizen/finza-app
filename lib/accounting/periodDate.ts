/**
 * Canonical YYYY-MM-DD helpers for accounting period_start values.
 * Shared by dashboard (server + client) so DATE and ISO strings compare the same way.
 */

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/

export function normalizePeriodStart(value: unknown): string {
  const match = String(value ?? "").trim().match(DATE_PREFIX)
  return match ? match[1] : ""
}

export function periodStartYearMonth(value: unknown): string {
  const date = normalizePeriodStart(value)
  return date.length >= 7 ? date.slice(0, 7) : ""
}

export function isPeriodOnOrBefore(periodStart: unknown, businessToday: string): boolean {
  const start = normalizePeriodStart(periodStart)
  const today = normalizePeriodStart(businessToday)
  if (!start || !today) return false
  return start <= today
}

export function samePeriodStart(a: unknown, b: unknown): boolean {
  const left = normalizePeriodStart(a)
  const right = normalizePeriodStart(b)
  return Boolean(left) && left === right
}
