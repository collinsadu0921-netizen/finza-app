/**
 * Date-only helpers for VAT return periods.
 *
 * VAT periods are calendar months. Never derive them through local Date +
 * toISOString(), because that shifts the date by one day in non-UTC timezones.
 */

export type DateOnlyParts = {
  year: number
  month: number
  day: number
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const YEAR_MONTH_RE = /^(\d{4})-(\d{2})$/

export function parseDateOnly(value: string | null | undefined): DateOnlyParts | null {
  if (!value) return null
  const match = DATE_ONLY_RE.exec(value.trim())
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null
  }

  return { year, month, day }
}

export function parseYearMonth(value: string | null | undefined): { year: number; month: number } | null {
  if (!value) return null
  const match = YEAR_MONTH_RE.exec(value.trim())
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null
  }
  return { year, month }
}

export function yearMonthToStart(value: string | null | undefined): string | null {
  const parsed = parseYearMonth(value)
  if (!parsed) return null
  return `${parsed.year}-${String(parsed.month).padStart(2, "0")}-01`
}

export function yearMonthToEnd(value: string | null | undefined): string | null {
  const parsed = parseYearMonth(value)
  if (!parsed) return null
  const lastDay = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate()
  return `${parsed.year}-${String(parsed.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
}

export function isCalendarMonthPeriod(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined
): boolean {
  const start = parseDateOnly(periodStart)
  const end = parseDateOnly(periodEnd)
  if (!start || !end) return false
  if (start.day !== 1) return false
  if (start.year !== end.year || start.month !== end.month) return false

  const lastDay = new Date(Date.UTC(start.year, start.month, 0)).getUTCDate()
  return end.day === lastDay
}

export function currentYearMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}
