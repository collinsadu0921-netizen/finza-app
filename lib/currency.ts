/**
 * Currency Utilities
 * Maps currency codes to symbols and names
 */

/**
 * Get currency symbol from currency code
 * @param currencyCode - ISO currency code (e.g., 'GHS', 'USD', 'KES')
 * @returns Currency symbol (e.g., '₵', '$', 'KSh')
 */
export function getCurrencySymbol(currencyCode: string | null | undefined): string {
  if (!currencyCode) return "" // No fallback - return empty string if currency not set

  const code = currencyCode.toUpperCase().trim()
  
  const symbolMap: Record<string, string> = {
    'GHS': '₵',  // Ghana Cedi
    'USD': '$',  // US Dollar
    'EUR': '€',  // Euro
    'GBP': '£',  // British Pound
    'KES': 'KSh', // Kenyan Shilling
    'NGN': '₦',  // Nigerian Naira
    'ZAR': 'R',  // South African Rand
    'UGX': 'USh', // Ugandan Shilling
    'TZS': 'TSh', // Tanzanian Shilling
  }
  
  return symbolMap[code] || code // Return code if symbol not found
}

/**
 * Get currency name from currency code
 * @param currencyCode - ISO currency code
 * @returns Currency name (e.g., 'Ghana Cedi', 'US Dollar')
 */
export function getCurrencyName(currencyCode: string | null | undefined): string {
  if (!currencyCode) return "" // No fallback - return empty string if currency not set

  const code = currencyCode.toUpperCase().trim()
  
  const nameMap: Record<string, string> = {
    'GHS': 'Ghana Cedi',
    'USD': 'US Dollar',
    'EUR': 'Euro',
    'GBP': 'British Pound',
    'KES': 'Kenyan Shilling',
    'NGN': 'Nigerian Naira',
    'ZAR': 'South African Rand',
    'UGX': 'Ugandan Shilling',
    'TZS': 'Tanzanian Shilling',
  }
  
  return nameMap[code] || code
}


