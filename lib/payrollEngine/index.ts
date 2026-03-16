/**
 * Payroll Engine - Central Registry and Resolver
 * 
 * AUTHORITY: This is the SINGLE SOURCE OF TRUTH for all payroll calculations.
 * 
 * All payroll calculations MUST go through this module:
 * - Never import country-specific engines directly
 * - Never use legacy payroll calculation functions (lib/ghanaPayeEngine.ts)
 * - Always use calculatePayroll() from this module
 * 
 * Architecture:
 * - Registry pattern: country code → payroll engine plugin
 * - Versioned by effective date (payroll_month drives effectiveDate)
 * - Country normalization via lib/payments/eligibility.normalizeCountry()
 * 
 * Supported Countries:
 * - GH (Ghana) - Tier 1 (implemented)
 * - KE (Kenya) - Tier 2 (implemented)
 * - NG (Nigeria) - Tier 2 (implemented)
 * - UG (Uganda) - Tier 2 (implemented)
 * - TZ (Tanzania) - Tier 2 (implemented)
 * - RW (Rwanda) - Tier 2 (implemented)
 * - ZM (Zambia) - Tier 2 (implemented)
 */

import type { PayrollEngine, PayrollEngineConfig, PayrollCalculationResult } from './types'
import { MissingCountryError, UnsupportedCountryError } from './errors'
import { normalizeCountry, SUPPORTED_COUNTRIES, UNSUPPORTED_COUNTRY_MARKER } from '@/lib/payments/eligibility'
import { ghanaPayrollEngine } from './jurisdictions/ghana'
import { kenyaPayrollEngine } from './jurisdictions/kenya'
import { nigeriaPayrollEngine } from './jurisdictions/nigeria'
import { ugandaPayrollEngine } from './jurisdictions/uganda'
import { tanzaniaPayrollEngine } from './jurisdictions/tanzania'
import { rwandaPayrollEngine } from './jurisdictions/rwanda'
import { zambiaPayrollEngine } from './jurisdictions/zambia'

/**
 * Registry of payroll engines by jurisdiction code
 * 
 * Authority: This is the single source of truth for which engines are available.
 * Adding a country here makes it available system-wide.
 */
const PAYROLL_ENGINES: Record<string, PayrollEngine> = {
  'GH': ghanaPayrollEngine, // Ghana - Tier 1 (implemented)
  'KE': kenyaPayrollEngine, // Kenya - Tier 2 (implemented)
  'NG': nigeriaPayrollEngine, // Nigeria - Tier 2 (implemented)
  'UG': ugandaPayrollEngine, // Uganda - Tier 2 (implemented)
  'TZ': tanzaniaPayrollEngine, // Tanzania - Tier 2 (implemented)
  'RW': rwandaPayrollEngine, // Rwanda - Tier 2 (implemented)
  'ZM': zambiaPayrollEngine, // Zambia - Tier 2 (implemented)
}

/**
 * Normalize country code for payroll engine lookup
 * 
 * Uses shared country normalization from lib/payments/eligibility
 * 
 * @param country Country code or name
 * @returns Normalized ISO alpha-2 code
 * @throws MissingCountryError if country is null/undefined/empty
 * @throws UnsupportedCountryError if country is not in SUPPORTED_COUNTRIES
 */
function normalizeJurisdiction(country: string | null | undefined): string {
  const normalized = normalizeCountry(country)

  if (normalized === null) {
    throw new MissingCountryError()
  }

  if (normalized === UNSUPPORTED_COUNTRY_MARKER) {
    throw new UnsupportedCountryError(String(country))
  }

  return normalized
}

/**
 * Get payroll engine for a jurisdiction
 * 
 * @param jurisdiction Normalized ISO alpha-2 country code
 * @returns Payroll engine for the jurisdiction
 * @throws UnsupportedCountryError if no engine is implemented for the jurisdiction
 */
function getPayrollEngine(jurisdiction: string): PayrollEngine {
  const engine = PAYROLL_ENGINES[jurisdiction]

  if (!engine) {
    // Country is in SUPPORTED_COUNTRIES but no engine implemented
    throw new UnsupportedCountryError(jurisdiction)
  }

  return engine
}

/**
 * Calculate payroll for a single employee
 * 
 * Authority: This is the single entry point for all payroll calculations.
 * All payroll calculations MUST use this function.
 * 
 * @param config Payroll calculation configuration
 * @param businessCountry Business country code (for jurisdiction resolution)
 * @returns Payroll calculation result
 * @throws MissingCountryError if businessCountry is not provided
 * @throws UnsupportedCountryError if country is not supported or not implemented
 */
export function calculatePayroll(
  config: PayrollEngineConfig,
  businessCountry: string | null | undefined
): PayrollCalculationResult {
  // Normalize jurisdiction from business country
  const jurisdiction = normalizeJurisdiction(businessCountry)

  // Get appropriate engine
  const engine = getPayrollEngine(jurisdiction)

  // Merge jurisdiction into config (override any provided jurisdiction)
  const finalConfig: PayrollEngineConfig = {
    ...config,
    jurisdiction,
  }

  // Calculate payroll using engine
  return engine.calculate(finalConfig)
}

/**
 * Check if a country has a payroll engine implemented
 * 
 * @param country Country code or name
 * @returns true if engine is implemented, false otherwise
 */
export function hasPayrollEngine(country: string | null | undefined): boolean {
  try {
    const jurisdiction = normalizeJurisdiction(country)
    return jurisdiction in PAYROLL_ENGINES
  } catch {
    return false
  }
}
