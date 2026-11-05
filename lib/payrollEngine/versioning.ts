/**
 * Payroll Engine Versioning Helpers
 * 
 * Authority: This module provides versioning utilities for payroll calculations.
 * Ensures consistent effective date handling across all payroll engines.
 */

/**
 * Round to 2 decimal places (consistent with accounting precision)
 */
export function roundPayroll(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Extract date part from ISO date string
 *
 * @param dateString ISO date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)
 * @returns Date part (YYYY-MM-DD)
 */
export function extractDatePart(dateString: string): string {
  return dateString.split('T')[0]
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function isValidCalendarDate(datePart: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(datePart)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const utc = new Date(Date.UTC(year, month - 1, day))
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  )
}

/**
 * Normalize a payroll/statutory date to a calendar date (YYYY-MM-DD).
 *
 * - A date-only string is preserved exactly.
 * - A timestamp is reduced to the calendar date written in that timestamp.
 *   The host/server timezone is never consulted, so the result cannot shift
 *   to the previous or next day when the machine timezone changes.
 * - Impossible calendar dates (e.g. 2026-02-30) are rejected.
 *
 * Rate selection must use this function (or a stored DATE column) so that a
 * timezone-shifted instant can never select the previous month's rates.
 */
export function toCalendarDate(value: string): string {
  const raw = String(value ?? '').trim()
  if (!raw) {
    throw new Error('Invalid payroll date: value is empty. Expected YYYY-MM-DD.')
  }

  const candidate = raw.slice(0, 10)
  if (!DATE_ONLY_PATTERN.test(candidate)) {
    throw new Error(
      `Invalid payroll date: "${value}". Expected YYYY-MM-DD or an ISO timestamp beginning with YYYY-MM-DD.`
    )
  }
  if (raw.length > 10 && raw[10] !== 'T' && raw[10] !== ' ') {
    throw new Error(
      `Invalid payroll date: "${value}". Expected YYYY-MM-DD or an ISO timestamp beginning with YYYY-MM-DD.`
    )
  }
  if (!isValidCalendarDate(candidate)) {
    throw new Error(`Invalid payroll date: "${value}". Calendar date ${candidate} does not exist.`)
  }
  return candidate
}

/**
 * Validate effective date format
 * 
 * @param effectiveDate ISO date string
 * @throws Error if date format is invalid
 */
export function validateEffectiveDate(effectiveDate: string): void {
  const datePart = extractDatePart(effectiveDate)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  
  if (!dateRegex.test(datePart)) {
    throw new Error(`Invalid effective date format: "${effectiveDate}". Expected YYYY-MM-DD format.`)
  }

  const date = new Date(datePart)
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid effective date: "${effectiveDate}". Date is not valid.`)
  }
}
