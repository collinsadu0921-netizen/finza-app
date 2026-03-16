"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { buildServiceRoute } from "@/lib/service/routes"
import type { ScreenProps } from "./types"

type RunSummary = {
  total_failures?: number
  alertable_failures?: number
  check_counts?: Record<string, number>
}

type ForensicRun = {
  id: string
  started_at: string
  finished_at: string | null
  status: string
  summary: RunSummary | null
  alert_sent?: boolean
  created_at: string
}

type FailureCounts = {
  open: number
  acknowledged: number
  resolved: number
  ignored: number
}

type AccountingPeriod = {
  id: string
  business_id: string
  period_start: string
  period_end: string
  status: "open" | "closing" | "soft_closed" | "locked"
}

type PendingApproval = {
  scope_type: string
  scope_id: string
  proposal_hash: string
  delta: number
  approval_count: number
}

export default function HealthScreen({ mode, businessId }: ScreenProps) {
  const [loading, setLoading] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [error, setError] = useState("")

  const [latestRun, setLatestRun] = useState<ForensicRun | null>(null)
  const [failureCounts, setFailureCounts] = useState<FailureCounts | null>(null)
  const [forensicAllowed, setForensicAllowed] = useState(true)

  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])

  const loadForensic = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/accounting/forensic-runs?limit=1")
      if (res.status === 403) {
        setForensicAllowed(false)
        setLatestRun(null)
        setFailureCounts(null)
        return
      }
      if (!res.ok) throw new Error("Failed to load forensic runs")
      const data = await res.json()
      const runs = data.runs ?? []
      if (runs.length === 0) {
        setLatestRun(null)
        setFailureCounts(null)
        return
      }
      const run = runs[0]
      setLatestRun(run)
      const sumRes = await fetch(
        `/api/admin/accounting/forensic-failures/summary?run_id=${encodeURIComponent(run.id)}`
      )
      if (sumRes.ok) {
        const sumData = await sumRes.json()
        setFailureCounts({
          open: sumData.open ?? 0,
          acknowledged: sumData.acknowledged ?? 0,
          resolved: sumData.resolved ?? 0,
          ignored: sumData.ignored ?? 0,
        })
      } else {
        setFailureCounts(null)
      }
    } catch {
      setLatestRun(null)
      setFailureCounts(null)
    }
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
    setNoContext(!businessId)
  }, [businessId])

  useEffect(() => {
    let cancelled = false
    async function init() {
      await loadForensic()
      if (!cancelled) setLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [loadForensic])

  useEffect(() => {
    if (!businessId) return
    loadPeriods()
    loadPendingApprovals()
  }, [businessId, loadPeriods, loadPendingApprovals])

  const openCount = failureCounts?.open ?? 0
  const periodSummary = {
    open: periods.filter((p) => p.status === "open").length,
    soft_closed: periods.filter((p) => p.status === "soft_closed").length,
    locked: periods.filter((p) => p.status === "locked").length,
  }
  const nextOpenPeriod = periods
    .filter((p) => p.status === "open")
    .sort((a, b) => a.period_start.localeCompare(b.period_start))[0]

  const backHref = mode === "service" ? buildServiceRoute("/service/accounting", businessId) : "/accounting"
  const periodsHref = mode === "service" ? buildServiceRoute("/service/accounting/periods", businessId) : (businessId ? buildAccountingRoute("/accounting/periods", businessId) : "/accounting")
  const reconciliationHref = mode === "service" ? buildServiceRoute("/service/accounting/reconciliation", businessId) : (businessId ? buildAccountingRoute("/accounting/reconciliation", businessId) : "/accounting")

  return (
    
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <Link
              href={backHref}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            >
              ← Accounting
            </Link>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
              Accounting Health
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Read-only overview: latest forensic run, period status, and approval queue.
            </p>
          </div>

          {noContext && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
              <p className="text-amber-800 dark:text-amber-200">
                No business selected. Select a client or business to see period summary and approval queue.
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
                Forensic run and failure counts (if you have access) are shown below.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 mb-6">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Latest forensic run
              </h2>
              {loading ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
              ) : !forensicAllowed ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  You do not have access to forensic monitoring.
                </p>
              ) : !latestRun ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No runs yet.
                </p>
              ) : (
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Status</dt>
                    <dd>
                      <span
                        className={
                          (latestRun.summary?.alertable_failures ?? 0) > 0
                            ? "text-red-600 dark:text-red-400 font-medium"
                            : latestRun.status === "success"
                              ? "text-green-600 dark:text-green-400"
                              : "text-amber-600 dark:text-amber-400"
                        }
                      >
                        {latestRun.status === "success" ? "PASS" : latestRun.status.toUpperCase()}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Started</dt>
                    <dd className="text-gray-900 dark:text-gray-100">
                      {new Date(latestRun.started_at).toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Total failures</dt>
                    <dd className="text-gray-900 dark:text-gray-100">
                      {latestRun.summary?.total_failures ?? 0}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Alertable failures</dt>
                    <dd className="text-gray-900 dark:text-gray-100">
                      {latestRun.summary?.alertable_failures ?? 0}
                    </dd>
                  </div>
                </dl>
              )}
              {forensicAllowed && latestRun && (
                <Link
                  href={`/admin/accounting/forensic-runs/${latestRun.id}`}
                  className="mt-4 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  View run →
                </Link>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Open failures
              </h2>
              {!forensicAllowed || latestRun === null ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {!forensicAllowed
                    ? "No access to forensic data."
                    : "No run data."}
                </p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {openCount}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Failures not yet resolved or ignored in the latest run.
                  </p>
                  {latestRun && (
                    <Link
                      href={`/admin/accounting/forensic-runs/${latestRun.id}`}
                      className="mt-3 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Open in Forensic Runs →
                    </Link>
                  )}
                </>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Period summary
              </h2>
              {!businessId ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Select a business to see period status.
                </p>
              ) : (
                <>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Open</dt>
                      <dd className="text-gray-900 dark:text-gray-100">{periodSummary.open}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Soft closed</dt>
                      <dd className="text-gray-900 dark:text-gray-100">{periodSummary.soft_closed}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Locked</dt>
                      <dd className="text-gray-900 dark:text-gray-100">{periodSummary.locked}</dd>
                    </div>
                    {nextOpenPeriod && (
                      <div>
                        <dt className="text-gray-500 dark:text-gray-400">Next period to close</dt>
                        <dd className="text-gray-900 dark:text-gray-100">
                          {nextOpenPeriod.period_start}
                        </dd>
                      </div>
                    )}
                  </dl>
                  <Link
                    href={periodsHref}
                    className="mt-4 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    View periods →
                  </Link>
                </>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Approval queue
              </h2>
              {!businessId ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Select a business to see pending approvals.
                </p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {pendingApprovals.length}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Items awaiting second approval.
                  </p>
                  <Link
                    href={reconciliationHref}
                    className="mt-3 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Open reconciliation →
                  </Link>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    
  )
}

