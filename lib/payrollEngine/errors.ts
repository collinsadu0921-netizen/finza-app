/**
 * Payroll Engine Errors
 * 
 * Authority: This module defines error types for payroll engine operations.
 * All errors thrown by the payroll engine must use these types.
 */

/**
 * Error thrown when country is required but not provided
 */
export class MissingCountryError extends Error {
  constructor(message: string = "Country is required for payroll calculation. Business country must be set in Business Profile settings.") {
    super(message)
    this.name = "MissingCountryError"
  }
}

/**
 * Error thrown when country is provided but no payroll engine is implemented for it
 */
export class UnsupportedCountryError extends Error {
  public readonly countryCode: string

  constructor(countryCode: string, message: string = `No payroll engine implemented for country "${countryCode}".`) {
    super(message)
    this.name = "UnsupportedCountryError"
    this.countryCode = countryCode
  }
}
