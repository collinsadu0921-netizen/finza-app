/**
 * Tab-scoped industry mode management
 * Each browser tab maintains its own industry mode independently
 * 
 * Key principles:
 * - On first load (login): Read from DB and freeze in sessionStorage
 * - On subsequent loads: ONLY read from sessionStorage, never from DB
 * - Never overwrite sessionStorage once set (unless explicitly cleared)
 * - Each tab is completely independent
 */

const INDUSTRY_STORAGE_KEY = 'tab_industry_mode'
const INDUSTRY_INITIALIZED_KEY = 'tab_industry_initialized'

/**
 * Get the industry mode for the current tab from sessionStorage
 * Returns the tab-scoped industry or null if not set
 * This NEVER reads from the database - use ensureTabIndustryMode() for that
 */
export function getTabIndustryMode(): string | null {
  if (typeof window === 'undefined') return null
  
  try {
    return sessionStorage.getItem(INDUSTRY_STORAGE_KEY)
  } catch (e) {
    console.error('Error reading tab industry mode:', e)
    return null
  }
}

/**
 * Set the industry mode for the current tab
 * This only affects the current tab, not other tabs
 * Use this when the user manually changes industry
 */
export function setTabIndustryMode(industry: string | null): void {
  if (typeof window === 'undefined') return
  
  try {
    if (industry) {
      sessionStorage.setItem(INDUSTRY_STORAGE_KEY, industry)
      sessionStorage.setItem(INDUSTRY_INITIALIZED_KEY, 'true')
    } else {
      sessionStorage.removeItem(INDUSTRY_STORAGE_KEY)
      sessionStorage.removeItem(INDUSTRY_INITIALIZED_KEY)
    }
  } catch (e) {
    console.error('Error setting tab industry mode:', e)
  }
}

/**
 * Check if the tab's industry mode has been initialized
 */
export function isTabIndustryInitialized(): boolean {
  if (typeof window === 'undefined') return false
  
  try {
    return sessionStorage.getItem(INDUSTRY_INITIALIZED_KEY) === 'true'
  } catch (e) {
    return false
  }
}

/**
 * Get the current tab's industry mode, initializing from DB only if not already set
 * This is the main function pages should use - it ensures the industry is set
 * but only reads from DB on the very first call in a tab session
 * 
 * @param industryFromDatabase - The industry from the database (only used if not already initialized)
 * @returns The industry mode for this tab
 */
export function ensureTabIndustryMode(industryFromDatabase: string | null): string | null {
  if (typeof window === 'undefined') return industryFromDatabase
  
  // If already initialized, return the stored value (NEVER overwrite)
  if (isTabIndustryInitialized()) {
    return getTabIndustryMode()
  }
  
  // First time in this tab - initialize from database and freeze it
  if (industryFromDatabase) {
    setTabIndustryMode(industryFromDatabase)
    return industryFromDatabase
  }
  
  return null
}

/**
 * @deprecated Use ensureTabIndustryMode() instead
 * Initialize the tab's industry mode from database (only on first load)
 * This should be called once per tab session
 */
export function initializeTabIndustryMode(industryFromDatabase: string | null): string | null {
  return ensureTabIndustryMode(industryFromDatabase)
}

/**
 * Clear the tab's industry mode (useful for logout)
 */
export function clearTabIndustryMode(): void {
  if (typeof window === 'undefined') return
  
  try {
    sessionStorage.removeItem(INDUSTRY_STORAGE_KEY)
    sessionStorage.removeItem(INDUSTRY_INITIALIZED_KEY)
  } catch (e) {
    console.error('Error clearing tab industry mode:', e)
  }
}


