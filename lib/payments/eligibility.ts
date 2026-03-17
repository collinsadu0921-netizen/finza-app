/**
 * Payment Eligibility System
 * Single source of truth for payment method and provider availability by country
 * 
 * Rules:
 * - Missing country => no methods/providers allowed
 * - Unknown country => DEFAULT allows only cash + card
 * - No Ghana fallbacks - strict country mapping
 */

/**
 * Payment methods available in the system
 */
export type PaymentMethod = "cash" | "card" | "mobile_money" | "bank_transfer"

/**
 * Payment providers (integrations that exist)
 */
export type PaymentProvider = "hubtel" | "mtn_momo" | "paystack"

/**
 * Country ISO code (2-letter)
 */
export type CountryCode = string

/**
 * Supported Tier 1 & Tier 2 countries
 * These countries normalize to ISO alpha-2 codes and are recognized for tax engine registry
 * Tier 1: Countries with tax engines implemented (GH)
 * Tier 2: Countries planned for tax engine implementation (NG, KE, UG, TZ, RW, ZM)
 */
export const SUPPORTED_COUNTRIES = ['GH', 'NG', 'KE', 'UG', 'TZ', 'RW', 'ZM'] as const
export type SupportedCountry = typeof SUPPORTED_COUNTRIES[number]

/**
 * Special value indicating country is explicitly unsupported (not null)
 * Used to distinguish between missing country (null) and unsupported country (this constant)
 */
export const UNSUPPORTED_COUNTRY_MARKER = '__UNSUPPORTED__' as const

/**
 * Normalize business address_country to ISO country code
 * 
 * Authority: This function is the source of truth for country normalization.
 * Tax engine registry uses this normalization to determine jurisdiction.
 * 
 * Tier 1 & Tier 2 countries (GH, NG, KE, UG, TZ, RW, ZM) normalize to ISO alpha-2 codes.
 * Countries not in this set normalize to UNSUPPORTED_COUNTRY_MARKER (not null).
 * Missing country (null/undefined) returns null.
 * 
 * @param addressCountry - Business address_country field value
 * @returns 
 *   - ISO country code (GH, NG, KE, UG, TZ, RW, ZM) for supported countries
 *   - null if missing (not provided)
 *   - UNSUPPORTED_COUNTRY_MARKER if provided but not in supported set
 */
export function normalizeCountry(addressCountry: string | null | undefined): CountryCode | typeof UNSUPPORTED_COUNTRY_MARKER | null {
  if (!addressCountry) {
    return null
  }

  const normalized = addressCountry.trim().toUpperCase()

  // Map common country name variations to ISO codes
  // Tier 1 & Tier 2 countries: GH, NG, KE, UG, TZ, RW, ZM
  const countryMap: Record<string, CountryCode> = {
    // Ghana (Tier 1 - implemented)
    "GH": "GH",
    "GHANA": "GH",
    "GHA": "GH",
    // Nigeria (Tier 2 - planned)
    "NG": "NG",
    "NIGERIA": "NG",
    // Kenya (Tier 2 - planned)
    "KE": "KE",
    "KENYA": "KE",
    "KEN": "KE",
    // Uganda (Tier 2 - planned)
    "UG": "UG",
    "UGANDA": "UG",
    // Tanzania (Tier 2 - planned)
    "TZ": "TZ",
    "TANZANIA": "TZ",
    "UNITED REPUBLIC OF TANZANIA": "TZ",
    // Rwanda (Tier 2 - planned)
    "RW": "RW",
    "RWANDA": "RW",
    // Zambia (Tier 2 - planned)
    "ZM": "ZM",
    "ZAMBIA": "ZM",
  }

  const isoCode = countryMap[normalized]
  
  // If mapped to a supported country code, return it
  if (isoCode && (SUPPORTED_COUNTRIES as readonly string[]).includes(isoCode)) {
    return isoCode
  }
  
  // If already a 2-letter code that matches supported countries, return it
  if (normalized.length === 2 && (SUPPORTED_COUNTRIES as readonly string[]).includes(normalized)) {
    return normalized
  }

  // Country provided but not in supported set - return unsupported marker (not null)
  return UNSUPPORTED_COUNTRY_MARKER
}

/**
 * Get allowed payment methods for a country
 * 
 * @param countryCode - ISO country code (GH, KE, etc.) or null
 * @returns Array of allowed payment methods
 */
export function getAllowedMethods(countryCode: CountryCode | null): PaymentMethod[] {
  // Missing country => no methods allowed
  if (!countryCode) {
    return []
  }

  // Country-specific rules
  const countryRules: Record<CountryCode, PaymentMethod[]> = {
    // Ghana: all methods
    GH: ["cash", "card", "mobile_money", "bank_transfer"],
    // Kenya: cash, card, mobile_money, bank_transfer (no Ghana providers)
    KE: ["cash", "card", "mobile_money", "bank_transfer"],
    // Nigeria: cash, card, mobile_money, bank_transfer
    NG: ["cash", "card", "mobile_money", "bank_transfer"],
    // Tanzania: cash, card, mobile_money, bank_transfer
    TZ: ["cash", "card", "mobile_money", "bank_transfer"],
    // Uganda: cash, card, mobile_money, bank_transfer
    UG: ["cash", "card", "mobile_money", "bank_transfer"],
    // South Africa: cash, card, bank_transfer
    ZA: ["cash", "card", "bank_transfer"],
  }

  // Known country => return specific rules
  if (countryCode in countryRules) {
    return countryRules[countryCode]
  }

  // Unknown country => DEFAULT: only cash + card
  return ["cash", "card"]
}

/**
 * Get allowed payment providers for a country
 * 
 * @param countryCode - ISO country code (GH, KE, etc.) or null
 * @returns Array of allowed providers
 */
export function getAllowedProviders(countryCode: CountryCode | null): PaymentProvider[] {
  // Missing country => no providers allowed
  if (!countryCode) {
    return []
  }

  // Country-specific provider rules
  const providerRules: Record<CountryCode, PaymentProvider[]> = {
    // Ghana: Hubtel, MTN MoMo, and Paystack (mobile money + card)
    GH: ["hubtel", "mtn_momo", "paystack"],
    // Kenya: no Ghana providers
    KE: [],
    // Nigeria: no Ghana providers
    NG: [],
    // Tanzania: no Ghana providers
    TZ: [],
    // Uganda: no Ghana providers
    UG: [],
    // South Africa: no Ghana providers
    ZA: [],
  }

  // Known country => return specific rules
  if (countryCode in providerRules) {
    return providerRules[countryCode]
  }

  // Unknown country => no providers
  return []
}

/**
 * Assert that a payment method is allowed for a country
 * Throws error if not allowed
 * 
 * @param countryCode - ISO country code or null
 * @param method - Payment method to check
 * @throws Error if method is not allowed
 */
export function assertMethodAllowed(
  countryCode: CountryCode | null,
  method: PaymentMethod
): void {
  const allowed = getAllowedMethods(countryCode)
  if (!allowed.includes(method)) {
    throw new Error("Payment method/provider not available for your country.")
  }
}

/**
 * Assert that a payment provider is allowed for a country
 * Throws error if not allowed
 * 
 * @param countryCode - ISO country code or null
 * @param provider - Payment provider to check
 * @throws Error if provider is not allowed
 */
export function assertProviderAllowed(
  countryCode: CountryCode | null,
  provider: PaymentProvider
): void {
  const allowed = getAllowedProviders(countryCode)
  if (!allowed.includes(provider)) {
    throw new Error("Payment method/provider not available for your country.")
  }
}

/**
 * Get display label for mobile_money method based on country
 * 
 * @param countryCode - ISO country code or null
 * @returns Display label ("MoMo" for GH, "Mobile Money" otherwise)
 */
export function getMobileMoneyLabel(countryCode: CountryCode | null): string {
  return countryCode === "GH" ? "MoMo" : "Mobile Money"
}



