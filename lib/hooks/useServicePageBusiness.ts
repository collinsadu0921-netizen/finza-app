"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import {
  useWorkspaceBusiness,
  type WorkspaceBusiness,
} from "@/components/WorkspaceBusinessContext"
import { resolveServicePageBusiness } from "@/lib/hooks/resolveServicePageBusiness"

export type UseServicePageBusinessResult = {
  business: WorkspaceBusiness
  businessId: string | null
  /** True once tenant scope is resolved (including error states). */
  ready: boolean
  error: string | null
  /** Re-resolve after external workspace changes (e.g. store switcher). */
  refresh: () => Promise<WorkspaceBusiness | null>
}

/**
 * Service list pages: prefer WorkspaceBusinessContext for tenant scope.
 * Validates ?business_id= overrides; falls back to legacy auth resolution when
 * rendered outside the provider or before context is populated.
 */
export function useServicePageBusiness(
  urlBusinessId?: string | null
): UseServicePageBusinessResult {
  const { business: ctxBusiness, sessionUser } = useWorkspaceBusiness()
  const trimmedUrl = urlBusinessId?.trim() || null

  const [business, setBusiness] = useState<WorkspaceBusiness>(() =>
    !trimmedUrl && ctxBusiness?.id ? ctxBusiness : null
  )
  const [ready, setReady] = useState(() => !trimmedUrl && !!ctxBusiness?.id)
  const [error, setError] = useState<string | null>(null)

  const resolve = useCallback(async (): Promise<WorkspaceBusiness | null> => {
    const result = await resolveServicePageBusiness({
      supabase,
      ctxBusiness,
      sessionUserId: sessionUser?.id ?? null,
      urlBusinessId: trimmedUrl,
      getUser: () => supabase.auth.getUser(),
    })

    if (!result.ok) {
      setBusiness(null)
      setError(result.error)
      setReady(true)
      return null
    }

    setBusiness(result.business)
    setError(null)
    setReady(true)
    return result.business
  }, [ctxBusiness, sessionUser?.id, trimmedUrl])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await resolve()
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
  }, [resolve])

  useEffect(() => {
    const onBusinessChanged = () => {
      void resolve()
    }
    window.addEventListener("finza:business-changed", onBusinessChanged)
    return () => window.removeEventListener("finza:business-changed", onBusinessChanged)
  }, [resolve])

  return {
    business,
    businessId: business?.id ?? null,
    ready,
    error,
    refresh: resolve,
  }
}
