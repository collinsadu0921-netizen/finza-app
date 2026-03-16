"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import Link from "next/link"

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
  created_at: string
}

type ListResponse = {
  runs: ForensicRun[]
  total: number
  page: number
  limit: number
}

const PAGE_SIZE = 20

export default function ForensicRunsListPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [runs, setRuns] = useState<ForensicRun[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState("")
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    loadRuns()
  }, [page])

  const loadRuns = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(
        `/api/admin/accounting/forensic-runs?page=${page}&limit=${PAGE_SIZE}`
      )
      if (res.status === 403) {
        setForbidden(true)
        setLoading(false)
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data: ListResponse = await res.json()
      setRuns(data.runs)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load runs")
      setRuns([])
    } finally {
      setLoading(false)
    }
  }

  const totalFailures = (run: ForensicRun) =>
    run.summary?.total_failures ?? 0
  const alertableFailures = (run: ForensicRun) =>
    run.summary?.alertable_failures ?? 0

  const rowBg = (run: ForensicRun) => {
    if (alertableFailures(run) > 0) return "bg-red-50 dark:bg-red-950/30"
    if (run.status !== "success") return "bg-amber-50 dark:bg-amber-950/30"
    return "bg-green-50 dark:bg-green-950/20"
  }

  const formatDate = (s: string | null) =>
    s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—"

  if (forbidden) {
    return (
      <ProtectedLayout>
        <div className="p-6 max-w-2xl">
          <p className="text-red-600 dark:text-red-400">
            You don’t have access to forensic monitoring. Only Owner, Firm Admin, or Accounting Admin can view this page.
          </p>
          <Link
            href="/accounting"
            className="mt-4 inline-block text-blue-600 dark:text-blue-400 hover:underline"
          >
            Back to Accounting
          </Link>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
              Forensic Runs
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Accounting invariant run history. Green = no failures, Red = alertable failures, Yellow = non-success status.
            </p>
          </div>
          <Link
            href="/accounting"
            className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
          >
            ← Accounting
          </Link>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-gray-500 dark:text-gray-400">Loading runs…</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Run ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Started
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Finished
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Total Failures
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Alertable
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {runs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                        No runs found.
                      </td>
                    </tr>
                  ) : (
                    runs.map((run) => (
                      <tr
                        key={run.id}
                        className={`${rowBg(run)} cursor-pointer hover:opacity-90`}
                        onClick={() =>
                          router.push(`/admin/accounting/forensic-runs/${run.id}`)
                        }
                      >
                        <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-white truncate max-w-[180px]">
                          {run.id}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                          {run.status}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {formatDate(run.started_at)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {formatDate(run.finished_at)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">
                          {totalFailures(run)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">
                          {alertableFailures(run)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {total > PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Page {page} of {Math.ceil(total / PAGE_SIZE)} ({total} runs)
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 text-sm"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= Math.ceil(total / PAGE_SIZE)}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 text-sm"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ProtectedLayout>
  )
}
