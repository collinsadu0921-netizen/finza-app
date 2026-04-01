"use client"

import { useState, useEffect, useCallback } from "react"

export type AccountingReadinessState = {
  ready: boolean | null
  authority_source: "owner" | "employee" | "accountant" | "report_viewer" | null
  loading: boolean
  error: string | null
  refetch: () => void
}

type ReadinessStateBase = Omit<AccountingReadinessState, "refetch">

/**
 * Fetches /api/accounting/readiness?business_id=... for readiness guard.
 * When authority_source === "accountant" (firm) and !ready, show EmptyState instead of calling bootstrap.
 */
function doFetch(
  businessId: string,
  setState: React.Dispatch<React.SetStateAction<ReadinessStateBase>>
) {
  setState((s) => ({ ...s, loading: true, error: null }))
  fetch(`/api/accounting/readiness?business_id=${encodeURIComponent(businessId)}`)
    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      setState((s) => {
        if (!ok) {
          return {
            ...s,
            ready: false,
            authority_source: data?.authority_source ?? null,
            loading: false,
            error: data?.error ?? "Failed to check readiness",
          }
        }
        return {
          ...s,
          ready: data.ready === true,
          authority_source: data.authority_source ?? null,
          loading: false,
          error: null,
        }
      })
    })
    .catch((err) => {
      setState((s) => ({
        ...s,
        ready: null,
        authority_source: null,
        loading: false,
        error: err?.message ?? "Failed to check readiness",
      }))
    })
}

export function useAccountingReadiness(businessId: string | null): AccountingReadinessState {
  const [state, setState] = useState<ReadinessStateBase>({
    ready: null,
    authority_source: null,
    loading: true,
    error: null,
  })

  const refetch = useCallback(() => {
    if (businessId) doFetch(businessId, setState)
  }, [businessId])

  useEffect(() => {
    if (!businessId) {
      setState({ ready: null, authority_source: null, loading: false, error: null } as ReadinessStateBase)
      return
    }
    doFetch(businessId, setState)
  }, [businessId])

  return { ...state, refetch }
}

/** Message for firm users when accounting is not initialized. */
export const ACCOUNTING_NOT_INITIALIZED_TITLE = "Accounting not initialized for this client"
export const ACCOUNTING_NOT_INITIALIZED_DESCRIPTION =
  "The business owner must initialize accounting before firm access is available."
export const ACCOUNTING_NOT_INITIALIZED_ACCOUNTANT_SECONDARY =
  "Ask the business owner to initialize accounting from their dashboard."
