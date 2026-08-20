"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { isStaleClientAuthorityResponse } from "@/lib/accounting/practiceShellSession"
import {
  READINESS_TTL_MS,
  invalidateClientBooksBusiness,
  sharedClientBooksJson,
} from "@/lib/accounting/clientBooksRequestShare"

export type AccountingAuthorityState = {
  authority_source: "owner" | "employee" | "accountant" | null
  access_level: "read" | "write" | "approve" | null
  engagement_status: string | null
  loading: boolean
  error: string | null
  refetch: () => void
}

type CachedAuthority = {
  authority_source: "owner" | "employee" | "accountant" | null
  access_level: "read" | "write" | "approve" | null
  engagement_status: string | null
  at: number
}

const UI_AUTHORITY_TTL_MS = 20_000
const uiAuthorityCache = new Map<string, CachedAuthority>()

export function clearAccountingAuthorityUiCache(businessId?: string) {
  if (businessId) uiAuthorityCache.delete(businessId)
  else uiAuthorityCache.clear()
}

/**
 * Fetches accounting authority for the current user and business (readiness API).
 * UI-only short cache; server mutations remain authoritative.
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
  const requestGen = useRef(0)
  const watchedBusinessId = useRef(businessId)

  const doFetch = useCallback((force = false) => {
    const gen = ++requestGen.current
    watchedBusinessId.current = businessId
    if (!businessId) {
      setState((s) => ({ ...s, authority_source: null, access_level: null, engagement_status: null, loading: false, error: null }))
      return
    }
    const cached = uiAuthorityCache.get(businessId)
    if (!force && cached && Date.now() - cached.at < UI_AUTHORITY_TTL_MS) {
      setState({
        authority_source: cached.authority_source,
        access_level: cached.access_level,
        engagement_status: cached.engagement_status,
        loading: false,
        error: null,
      })
      return
    }
    setState((s) => ({ ...s, loading: !cached, error: null }))
    sharedClientBooksJson<{
      authority_source?: CachedAuthority["authority_source"]
      access_level?: CachedAuthority["access_level"]
      engagement_status?: string | null
      error?: string
    }>(`/api/accounting/readiness?business_id=${encodeURIComponent(businessId)}`, {
      ttlMs: READINESS_TTL_MS,
    })
      .then(({ ok, json: data }) => {
        if (requestGen.current !== gen || isStaleClientAuthorityResponse(businessId, watchedBusinessId.current)) return
        const next = {
          authority_source: (data?.authority_source ?? null) as CachedAuthority["authority_source"],
          access_level: (data?.access_level ?? null) as CachedAuthority["access_level"],
          engagement_status: (data?.engagement_status ?? null) as string | null,
          at: Date.now(),
        }
        uiAuthorityCache.set(businessId, next)
        setState({
          authority_source: next.authority_source,
          access_level: next.access_level,
          engagement_status: next.engagement_status,
          loading: false,
          error: ok ? null : (data?.error ?? "Failed to load"),
        })
      })
      .catch((err) => {
        if (requestGen.current !== gen || isStaleClientAuthorityResponse(businessId, watchedBusinessId.current)) return
        setState({
          authority_source: null,
          access_level: null,
          engagement_status: null,
          loading: false,
          error: err?.message ?? "Failed to load",
        })
      })
  }, [businessId])

  useEffect(() => {
    if (watchedBusinessId.current && businessId && watchedBusinessId.current !== businessId) {
      clearAccountingAuthorityUiCache(watchedBusinessId.current)
      invalidateClientBooksBusiness(watchedBusinessId.current)
    }
    doFetch()
  }, [doFetch, businessId])

  return { ...state, refetch: () => doFetch(true) }
}
