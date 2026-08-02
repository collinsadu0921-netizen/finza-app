/**
 * Business Currency Hook
 * Provides centralized access to business currency for UI components
 *
 * Loads business currency once and provides formatting utilities
 * No Ghana fallbacks - returns null if currency not set
 */

import { useState, useEffect, useMemo } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import {
  syncBusinessCurrencyFromRow,
  formatBusinessCurrencyAmount,
  formatBusinessCurrencyAmountWithCode,
} from "@/lib/hooks/businessCurrencyCore"
import {
  useWorkspaceBusiness,
  type WorkspaceBusiness,
} from "@/components/WorkspaceBusinessContext"

export interface UseBusinessCurrencyResult {
  currencyCode: string | null
  currencySymbol: string | null
  ready: boolean
  format: (amount: number | null | undefined) => string
  formatWithCode: (amount: number | null | undefined) => string
  businessId: string | null
}

export type UseBusinessCurrencyOptions = {
  /** When set, skips workspace context and legacy fetch for this business row. */
  business?: WorkspaceBusiness | null
}

/**
 * Hook to access business currency.
 * Prefers WorkspaceBusinessContext when inside ProtectedLayout.
 */
export function useBusinessCurrency(
  options?: UseBusinessCurrencyOptions
): UseBusinessCurrencyResult {
  const { business: ctxBusiness } = useWorkspaceBusiness()
  const sourceBusiness = options?.business ?? ctxBusiness

  const [currencyCode, setCurrencyCode] = useState<string | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const setters = {
      setBusinessId: (id: string | null) => {
        if (mounted) setBusinessId(id)
      },
      setCurrencyCode: (code: string | null) => {
        if (mounted) setCurrencyCode(code)
      },
      setCurrencySymbol: (symbol: string | null) => {
        if (mounted) setCurrencySymbol(symbol)
      },
      setReady: (value: boolean) => {
        if (mounted) setReady(value)
      },
    }

    if (sourceBusiness?.id) {
      const synced = syncBusinessCurrencyFromRow(sourceBusiness)
      setters.setBusinessId(synced.businessId)
      setters.setCurrencyCode(synced.currencyCode)
      setters.setCurrencySymbol(synced.currencySymbol)
      setters.setReady(true)
      return () => {
        mounted = false
      }
    }

    const loadCurrency = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          if (mounted) setReady(true)
          return
        }

        const business = await getCurrentBusiness(supabase, user.id)

        if (!business) {
          if (mounted) setReady(true)
          return
        }

        if (mounted) {
          const synced = syncBusinessCurrencyFromRow(business as WorkspaceBusiness)
          setters.setBusinessId(synced.businessId)
          setters.setCurrencyCode(synced.currencyCode)
          setters.setCurrencySymbol(synced.currencySymbol)
          setters.setReady(true)
        }
      } catch (err) {
        console.error("Error loading business currency:", err)
        if (mounted) setReady(true)
      }
    }

    void loadCurrency()

    return () => {
      mounted = false
    }
  }, [sourceBusiness?.id, sourceBusiness?.default_currency])

  const format = useMemo(
    () => (amount: number | null | undefined) => formatBusinessCurrencyAmount(amount, currencyCode),
    [currencyCode]
  )

  const formatWithCode = useMemo(
    () => (amount: number | null | undefined) =>
      formatBusinessCurrencyAmountWithCode(amount, currencyCode),
    [currencyCode]
  )

  return {
    currencyCode,
    currencySymbol,
    ready,
    format,
    formatWithCode,
    businessId,
  }
}
