/**
 * Country-Currency Validation
 * Enforces valid country-currency combinations
 */

import { normalizeCountry } from "./payments/eligibility"

/**
 * Country to currency mapping
 * Each country has a primary currency
 */
const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  GH: "GHS", // Ghana → Ghana Cedi
  KE: "KES", // Kenya → Kenyan Shilling
  NG: "NGN", // Nigeria → Nigerian Naira
  TZ: "TZS", // Tanzania → Tanzanian Shilling
  UG: "UGX", // Uganda → Ugandan Shilling
  ZA: "ZAR", // South Africa → South African Rand
  US: "USD", // United States → US Dollar
  GB: "GBP", // United Kingdom → British Pound
  EU: "EUR", // European Union → Euro
}

/**
 * Validate that currency matches country
 * 
 * @param countryCode - ISO country code (GH, KE, etc.) or null
 * @param currencyCode - ISO currency code (GHS, KES, etc.) or null
 * @returns true if valid, false if invalid
 */
export function validateCountryCurrency(
  countryCode: string | null,
  currencyCode: string | null
): boolean {
  // If country is missing, currency validation cannot be performed
  if (!countryCode) {
    return false
  }

  // If currency is missing, invalid
  if (!currencyCode) {
    return false
  }

  // Get expected currency for country
  const expectedCurrency = COUNTRY_CURRENCY_MAP[countryCode]

  // If country not in map, allow any currency (unknown country)
  if (!expectedCurrency) {
    return true
  }

  // Currency must match expected currency for country
  return currencyCode.toUpperCase() === expectedCurrency.toUpperCase()
}

/**
 * Get expected currency for a country
 * 
 * @param countryCode - ISO country code (GH, KE, etc.) or null
 * @returns Expected currency code or null if country unknown
 */
export function getExpectedCurrency(countryCode: string | null): string | null {
  if (!countryCode) {
    return null
  }

  return COUNTRY_CURRENCY_MAP[countryCode] || null
}

/**
 * Assert that currency matches country
 * Throws error if invalid
 * 
 * @param countryCode - ISO country code or null
 * @param currencyCode - ISO currency code or null
 * @throws Error if currency does not match country
 */
export function assertCountryCurrency(
  countryCode: string | null,
  currencyCode: string | null
): void {
  if (!validateCountryCurrency(countryCode, currencyCode)) {
    const countryName = countryCode || "unknown"
    const currencyName = currencyCode || "missing"
    const expected = countryCode ? getExpectedCurrency(countryCode) : null
    
    if (!countryCode) {
      throw new Error("Country must be set before setting currency. Please set your business country first.")
    }
    
    if (!currencyCode) {
      throw new Error("Currency must be set. Please select your business currency in Business Profile.")
    }
    
    if (expected) {
      throw new Error(`Currency ${currencyName} is not valid for country ${countryName}. Expected currency: ${expected}.`)
    } else {
      throw new Error(`Currency ${currencyName} validation failed for country ${countryName}.`)
    }
  }
}



