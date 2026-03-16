/**
 * Tax Engine Error Types
 * 
 * Explicit error semantics for tax calculation:
 * - MissingCountryError: Country not provided (null/undefined)
 * - UnsupportedCountryError: Country provided but tax engine not implemented yet
 */

/**
 * Error thrown when country is missing (null/undefined)
 * This indicates a configuration issue - business country must be set
 */
export class MissingCountryError extends Error {
  constructor(message: string = "Country is required for tax calculation. Business country must be set in Business Profile settings.") {
    super(message)
    this.name = "MissingCountryError"
  }
}

/**
 * Error thrown when country is recognized but tax engine is not yet implemented
 * This indicates a supported country that needs tax plugin development
 */
export class UnsupportedCountryError extends Error {
  public readonly countryCode: string

  constructor(countryCode: string, message?: string) {
    super(message || `Tax calculation is not yet implemented for country "${countryCode}". Tax engine plugin required.`)
    this.name = "UnsupportedCountryError"
    this.countryCode = countryCode
  }
}
