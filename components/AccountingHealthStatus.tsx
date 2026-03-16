"use client"

import { useState, useEffect } from "react"
import Link from "next/link"

type RunSummary = {
  total_failures?: number
  alertable_failures?: number
}

type ForensicRun = {
  id: string
  started_at: string
  finished_at: string | null
  status: string
  summary: RunSummary | null
}

type FailureCounts = {
  open: number
  acknowledged: number
  resolved: number
  ignored: number
}

/**
 * Reusable widget: last forensic run status, time, failure count, and lifecycle counts.
 * Uses latest run only. Read-only.
 */
export default function AccountingHealthStatus() {
  const [run, setRun] = useState<ForensicRun | null>(null)
  const [counts, setCounts] = useState<FailureCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function fetchLatest() {
      try {
        const res = await fetch("/api/admin/accounting/forensic-runs?limit=1")
        if (!res.ok) {
          if (res.status === 403) {
            setRun(null)
            setCounts(null)
            setLoading(false)
            return
          }
          throw new Error("Failed to load")
        }
        const data = await res.json()
        if (!cancelled && data.runs?.length) {
          const latest = data.runs[0]
          setRun(latest)
          const sumRes = await fetch(
            `/api/admin/accounting/forensic-failures/summary?run_id=${encodeURIComponent(latest.id)}`
          )
          if (sumRes.ok) {
            const sumData = await sumRes.json()
            setCounts({
              open: sumData.open ?? 0,
              acknowledged: sumData.acknowledged ?? 0,
              resolved: sumData.resolved ?? 0,
              ignored: sumData.ignored ?? 0,
            })
          } else {
            setCounts(null)
          }
        } else {
          setRun(null)
          setCounts(null)
        }
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchLatest()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
          Accounting health
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {error ? "Unable to load status." : "No runs yet."}
        </p>
        <Link
          href="/admin/accounting/forensic-runs"
          className="mt-2 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Forensic Runs →
        </Link>
      </div>
    )
  }

  const failures = run.summary?.total_failures ?? 0
  const alertable = run.summary?.alertable_failures ?? 0
  const lastRunTime = run.finished_at || run.started_at
  const statusLabel = run.status === "success" ? "PASS" : run.status.toUpperCase()
  const statusColor =
    alertable > 0
      ? "text-red-600 dark:text-red-400"
      : run.status !== "success"
        ? "text-amber-600 dark:text-amber-400"
        : "text-green-600 dark:text-green-400"

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
        Accounting health
      </h3>
      <dl className="grid grid-cols-1 gap-1 text-sm">
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Last run status</dt>
          <dd className={statusColor}>{statusLabel}</dd>
        </div>
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Last run time</dt>
          <dd className="text-gray-700 dark:text-gray-300">
            {new Date(lastRunTime).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Failures count</dt>
          <dd className="text-gray-700 dark:text-gray-300">{failures}</dd>
        </div>
        {counts && (
          <>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Open failures</dt>
              <dd className="text-red-600 dark:text-red-400">{counts.open}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Acknowledged failures</dt>
              <dd className="text-amber-600 dark:text-amber-400">{counts.acknowledged}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Resolved failures</dt>
              <dd className="text-green-600 dark:text-green-400">{counts.resolved}</dd>
            </div>
          </>
        )}
      </dl>
      <Link
        href="/admin/accounting/forensic-runs"
        className="mt-3 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        View Forensic Runs →
      </Link>
    </div>
  )
}
