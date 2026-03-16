/**
 * Business Currency Hook
 * Provides centralized access to business currency for UI components
 * 
 * Loads business currency once and provides formatting utilities
 * No Ghana fallbacks - returns null if currency not set
 */

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { getCurrencySymbol } from "@/lib/currency"
import { formatMoney, formatMoneyWithCode } from "@/lib/money"

export interface UseBusinessCurrencyResult {
  /**
   * Currency code (e.g., 'GHS', 'USD', 'KES')
   * null if not set or not yet loaded
   */
  currencyCode: string | null
  
  /**
   * Currency symbol (e.g., '₵', '$', 'KSh')
   * null if currency not set
   */
  currencySymbol: string | null
  
  /**
   * Whether business data has been loaded
   * true even if currency is null (indicates currency is missing, not loading)
   */
  ready: boolean
  
  /**
   * Format amount using business currency
   * Returns "—" if currency not set
   */
  format: (amount: number | null | undefined) => string
  
  /**
   * Format amount with currency code
   * Returns "—" if currency not set
   */
  formatWithCode: (amount: number | null | undefined) => string
  
  /**
   * Business ID (for reference)
   */
  businessId: string | null
}

/**
 * Hook to access business currency
 * 
 * @example
 * const { currencyCode, currencySymbol, ready, format } = useBusinessCurrency()
 * 
 * if (!ready) return <div>Loading...</div>
 * if (!currencyCode) return <div>Please set currency in Business Profile</div>
 * 
 * return <div>Total: {format(1234.56)}</div>
 */
export function useBusinessCurrency(): UseBusinessCurrencyResult {
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const loadCurrency = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          if (mounted) {
            setReady(true)
          }
          return
        }

        const business = await getCurrentBusiness(supabase, user.id)
        
        if (!business) {
          if (mounted) {
            setReady(true)
          }
          return
        }

        if (mounted) {
          setBusinessId(business.id)
          
          // Get currency from business - no fallback
          const code = business.default_currency || null
          setCurrencyCode(code)
          
          // Get symbol if currency exists
          if (code) {
            setCurrencySymbol(getCurrencySymbol(code))
          } else {
            setCurrencySymbol(null)
          }
          
          setReady(true)
        }
      } catch (err) {
        console.error("Error loading business currency:", err)
        if (mounted) {
          setReady(true)
        }
      }
    }

    loadCurrency()

    return () => {
      mounted = false
    }
  }, [])

  const format = (amount: number | null | undefined): string => {
    return formatMoney(amount, currencyCode)
  }

  const formatWithCode = (amount: number | null | undefined): string => {
    return formatMoneyWithCode(amount, currencyCode)
  }

  return {
    currencyCode,
    currencySymbol,
    ready,
    format,
    formatWithCode,
    businessId,
  }
}

