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
