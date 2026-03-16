"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import { resolveServiceBusinessContext } from "@/lib/serviceBusinessContext"

type AccountingPeriod = {
  id: string
  business_id: string
  period_start: string
  period_end: string
  status: string
}

type PendingApproval = {
  scope_type: string
  scope_id: string
  proposal_hash: string
  delta: number
  approval_count: number
}

export default function ServiceHealthPage() {
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [noContext, setNoContext] = useState(false)
  const [error, setError] = useState("")
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])

  const loadContext = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError("Not authenticated")
      return
    }
    const ctx = await resolveServiceBusinessContext(supabase, user.id)
    if ("error" in ctx) {
      setNoContext(true)
      setBusinessId(null)
      return
    }
    setBusinessId(ctx.businessId)
  }, [])

  const loadPeriods = useCallback(async () => {
    if (!businessId) return
    try {
      const res = await fetch(`/api/accounting/periods?business_id=${businessId}`)
      if (!res.ok) return
      const data = await res.json()
      setPeriods(data.periods ?? [])
    } catch {
      setPeriods([])
    }
  }, [businessId])

  const loadPendingApprovals = useCallback(async () => {
    if (!businessId) return
    try {
      const res = await fetch(`/api/accounting/reconciliation/pending-approvals?businessId=${businessId}`)
      if (!res.ok) return
      const data = await res.json()
      setPendingApprovals(data.pending ?? [])
    } catch {
      setPendingApprovals([])
    }
  }, [businessId])

  useEffect(() => {
    let cancelled = false
    async function init() {
      await loadContext()
      if (cancelled) return
      setLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [loadContext])

  useEffect(() => {
    if (!businessId) return
    loadPeriods()
    loadPendingApprovals()
  }, [businessId, loadPeriods, loadPendingApprovals])

  const periodSummary = {
    open: periods.filter((p) => p.status === "open").length,
    soft_closed: periods.filter((p) => p.status === "soft_closed").length,
    locked: periods.filter((p) => p.status === "locked").length,
  }
  const nextOpenPeriod = periods.filter((p) => p.status === "open").sort((a, b) => a.period_start.localeCompare(b.period_start))[0]

  if (loading) {
    return (
      
        <div className="p-6"><p>Loading...</p></div>
      
    )
  }

  if (noContext) {
    return (
      
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-6 text-amber-800 dark:text-amber-200">
              <p className="font-medium">No business found.</p>
              <p className="text-sm mt-1">Ensure you have an active business to view health.</p>
              <Link href="/service/dashboard" className="mt-4 inline-block text-sm text-amber-700 dark:text-amber-300 hover:underline">← Back to Dashboard</Link>
            </div>
          </div>
        </div>
      
    )
  }

  return (
    
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <Link href="/service/dashboard" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">← Dashboard</Link>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-2">Financial Health</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">Read-only overview: period status and reconciliation alerts.</p>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 mb-6">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Period summary</h2>
              {!businessId ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No business selected.</p>
              ) : (
                <>
                  <dl className="space-y-2 text-sm">
                    <div><dt className="text-gray-500 dark:text-gray-400">Open</dt><dd className="text-gray-900 dark:text-gray-100">{periodSummary.open}</dd></div>
                    <div><dt className="text-gray-500 dark:text-gray-400">Soft closed</dt><dd className="text-gray-900 dark:text-gray-100">{periodSummary.soft_closed}</dd></div>
                    <div><dt className="text-gray-500 dark:text-gray-400">Locked</dt><dd className="text-gray-900 dark:text-gray-100">{periodSummary.locked}</dd></div>
                    {nextOpenPeriod && (
                      <div><dt className="text-gray-500 dark:text-gray-400">Next period to close</dt><dd className="text-gray-900 dark:text-gray-100">{nextOpenPeriod.period_start}</dd></div>
                    )}
                  </dl>
                </>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Reconciliation alerts</h2>
              {!businessId ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No business selected.</p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{pendingApprovals.length}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Items awaiting approval.</p>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    
  )
}
