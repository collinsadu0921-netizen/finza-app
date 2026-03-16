"use client"

import { useState, useEffect, useCallback } from "react"

export type AccountingAuthorityState = {
  authority_source: "owner" | "employee" | "accountant" | null
  access_level: "read" | "write" | "approve" | null
  engagement_status: string | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Fetches accounting authority for the current user and business (readiness API).
 * For accountants, includes access_level and engagement_status for permission banner.
 */
export function useAccountingAuthority(businessId: string | null): AccountingAuthorityState {
  const [state, setState] = useState<{
    authority_source: "owner" | "employee" | "accountant" | null
    access_level: "read" | "write" | "approve" | null
    engagement_status: string | null
    loading: boolean
    error: string | null
  }>({
    authority_source: null,
    access_level: null,
    engagement_status: null,
    loading: true,
    error: null,
  })

  const doFetch = useCallback(() => {
    if (!businessId) {
      setState((s) => ({ ...s, authority_source: null, access_level: null, engagement_status: null, loading: false, error: null }))
      return
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    fetch(`/api/accounting/readiness?business_id=${encodeURIComponent(businessId)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        setState((s) => ({
          ...s,
          authority_source: data?.authority_source ?? null,
          access_level: data?.access_level ?? null,
          engagement_status: data?.engagement_status ?? null,
          loading: false,
          error: ok ? null : (data?.error ?? "Failed to load"),
        }))
      })
      .catch((err) => {
        setState((s) => ({
          ...s,
          authority_source: null,
          access_level: null,
          engagement_status: null,
          loading: false,
          error: err?.message ?? "Failed to load",
        }))
      })
  }, [businessId])

  useEffect(() => {
    doFetch()
  }, [doFetch])

  return { ...state, refetch: doFetch }
}
