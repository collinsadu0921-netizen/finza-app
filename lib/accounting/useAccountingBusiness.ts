"use client"

/**
 * Canonical business context for accounting workspace (Wave 5).
 * URL business_id is the ONLY source of client context. No cookie/session fallback.
 */

import { useSearchParams } from "next/navigation"
import { useMemo, useState, useEffect } from "react"

/** Canonical message for missing client. Use in EmptyState when contextError or !businessId. */
export const CLIENT_NOT_SELECTED_DESCRIPTION =
  "Client not selected. Please choose a client or use a Control Tower drill link."

export type UseAccountingBusinessResult = {
  businessId: string | null
  loading: boolean
  error: string | null
}

export function useAccountingBusiness(): UseAccountingBusinessResult {
  const searchParams = useSearchParams()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return useMemo(() => {
    if (!mounted) {
      return { businessId: null, loading: true, error: null }
    }

    const urlBusinessId = searchParams.get("business_id")?.trim() ?? null
    if (urlBusinessId) {
      return { businessId: urlBusinessId, loading: false, error: null }
    }

    return {
      businessId: null,
      loading: false,
      error: "CLIENT_REQUIRED",
    }
  }, [mounted, searchParams])
}
