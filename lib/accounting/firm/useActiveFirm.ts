"use client"

import { useCallback, useEffect, useState } from "react"
import {
  getActiveFirmId,
  setActiveFirmId,
} from "@/lib/accounting/firm/session"
import {
  resolveActiveFirmFromMemberships,
  type FirmMembershipOption,
  type ActiveFirmResolveReason,
} from "@/lib/accounting/firm/resolveActiveFirm"
import {
  FIRMS_TTL_MS,
  invalidateClientBooksFirms,
  sharedClientBooksJson,
} from "@/lib/accounting/clientBooksRequestShare"

export type UseActiveFirmResult = {
  firmId: string | null
  firmName: string | null
  role: string | null
  firms: FirmMembershipOption[]
  loading: boolean
  error: string | null
  requiresSelection: boolean
  reason: ActiveFirmResolveReason | null
  refresh: () => Promise<void>
}

/**
 * Hydrate Practice active firm from /api/accounting/firm/firms memberships.
 * Validates/repairs sessionStorage cache; never trusts it alone.
 */
export function useActiveFirm(): UseActiveFirmResult {
  const [firmId, setFirmId] = useState<string | null>(null)
  const [firmName, setFirmName] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [firms, setFirms] = useState<FirmMembershipOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requiresSelection, setRequiresSelection] = useState(false)
  const [reason, setReason] = useState<ActiveFirmResolveReason | null>(null)

  const refresh = useCallback(async () => {
    invalidateClientBooksFirms()
    setLoading(true)
    setError(null)
    try {
      const response = await sharedClientBooksJson<{
        firms?: Array<{ firm_id: string; firm_name: string; role?: string | null }>
      }>("/api/accounting/firm/firms", { ttlMs: FIRMS_TTL_MS })
      if (!response.ok) {
        setFirms([])
        setFirmId(null)
        setFirmName(null)
        setRole(null)
        setRequiresSelection(false)
        setReason(null)
        setError("Unable to load your firm. Try again.")
        return
      }
      const data = response.json
      const firmList: FirmMembershipOption[] = (data.firms || []).map(
        (f: { firm_id: string; firm_name: string; role?: string | null }) => ({
          firm_id: f.firm_id,
          firm_name: f.firm_name,
          role: f.role ?? null,
        })
      )
      const resolution = resolveActiveFirmFromMemberships({
        firms: firmList,
        storedFirmId: getActiveFirmId(),
      })
      if (resolution.shouldPersist) {
        setActiveFirmId(resolution.firmId, resolution.firmName)
      }
      setFirms(resolution.firms)
      setFirmId(resolution.firmId)
      setFirmName(resolution.firmName)
      setRole(resolution.role)
      setRequiresSelection(resolution.requiresSelection)
      setReason(resolution.reason)
    } catch {
      setError("Unable to load your firm. Try again.")
      setFirms([])
      setFirmId(null)
      setFirmName(null)
      setRole(null)
      setRequiresSelection(false)
      setReason(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFirm = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { firmId?: string | null; firmName?: string | null }
        | undefined
      if (detail && "firmId" in detail) {
        setFirmId(detail.firmId ?? null)
        setFirmName(detail.firmName ?? null)
        setRequiresSelection(false)
      } else {
        void refresh()
      }
    }
    window.addEventListener("firmChanged", onFirm as EventListener)
    return () => window.removeEventListener("firmChanged", onFirm as EventListener)
  }, [refresh])

  return {
    firmId,
    firmName,
    role,
    firms,
    loading,
    error,
    requiresSelection,
    reason,
    refresh,
  }
}

/**
 * One-shot hydration used by AccountingWorkspaceShell before firm-dependent fetches.
 */
export async function hydrateActiveFirmFromMemberships(): Promise<{
  firms: FirmMembershipOption[]
  firmId: string | null
  firmName: string | null
  requiresSelection: boolean
  error: string | null
}> {
  try {
    const response = await sharedClientBooksJson<{
      firms?: Array<{ firm_id: string; firm_name: string; role?: string | null }>
    }>("/api/accounting/firm/firms", { ttlMs: FIRMS_TTL_MS })
    if (!response.ok) {
      return {
        firms: [],
        firmId: null,
        firmName: null,
        requiresSelection: false,
        error: "Unable to load your firm. Try again.",
      }
    }
    const data = response.json
    const firmList: FirmMembershipOption[] = (data.firms || []).map(
      (f: { firm_id: string; firm_name: string; role?: string | null }) => ({
        firm_id: f.firm_id,
        firm_name: f.firm_name,
        role: f.role ?? null,
      })
    )
    const resolution = resolveActiveFirmFromMemberships({
      firms: firmList,
      storedFirmId: getActiveFirmId(),
    })
    if (resolution.shouldPersist) {
      setActiveFirmId(resolution.firmId, resolution.firmName)
    }
    return {
      firms: resolution.firms,
      firmId: resolution.firmId,
      firmName: resolution.firmName,
      requiresSelection: resolution.requiresSelection,
      error: null,
    }
  } catch {
    return {
      firms: [],
      firmId: null,
      firmName: null,
      requiresSelection: false,
      error: "Unable to load your firm. Try again.",
    }
  }
}
