"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import Link from "next/link"
import { buildAccountingRoute } from "@/lib/accounting/routes"

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

type Failure = {
  id: string
  run_id: string
  check_id: string
  business_id: string | null
  severity: string
  status: string
  acknowledged_by?: string | null
  acknowledged_at?: string | null
  resolved_by?: string | null
  resolved_at?: string | null
  resolution_note?: string | null
  payload?: unknown
  created_at: string
}

type FailuresResponse = {
  failures: Failure[]
  total: number
  page: number
  limit: number
}

const FAILURES_PAGE_SIZE = 25

export default function ForensicRunDetailPage() {
  const router = useRouter()
  const params = useParams()
  const runId = params?.run_id as string | undefined
  const [run, setRun] = useState<ForensicRun | null>(null)
  const [failures, setFailures] = useState<Failure[]>([])
  const [failuresTotal, setFailuresTotal] = useState(0)
  const [failuresPage, setFailuresPage] = useState(1)
  const [loadingRun, setLoadingRun] = useState(true)
  const [loadingFailures, setLoadingFailures] = useState(true)
  const [error, setError] = useState("")
  const [forbidden, setForbidden] = useState(false)
  const [filterCheckId, setFilterCheckId] = useState("")
  const [filterBusinessId, setFilterBusinessId] = useState("")
  const [filterSeverity, setFilterSeverity] = useState("")
  const [filterStatus, setFilterStatus] = useState("")
  const [expandedPayloadId, setExpandedPayloadId] = useState<string | null>(null)
  const [payloadCache, setPayloadCache] = useState<Record<string, unknown>>({})
  const [resolveModal, setResolveModal] = useState<{ open: boolean; failure: Failure | null; note: string }>({
    open: false,
    failure: null,
    note: "",
  })
  const [escalateModal, setEscalateModal] = useState<{
    open: boolean
    failure: Failure | null
    reason: string
    assignee: string
  }>({ open: false, failure: null, reason: "", assignee: "" })
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState("")

  const loadRun = useCallback(async () => {
    if (!runId) return
    setLoadingRun(true)
    setError("")
    try {
      const res = await fetch(`/api/admin/accounting/forensic-runs/${runId}`)
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const { run: r } = await res.json()
      setRun(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load run")
    } finally {
      setLoadingRun(false)
    }
  }, [runId])

  const loadFailures = useCallback(async () => {
    if (!runId) return
    setLoadingFailures(true)
    try {
      const q = new URLSearchParams({
        run_id: runId,
        page: String(failuresPage),
        limit: String(FAILURES_PAGE_SIZE),
      })
      if (filterCheckId) q.set("check_id", filterCheckId)
      if (filterBusinessId) q.set("business_id", filterBusinessId)
      if (filterSeverity) q.set("severity", filterSeverity)
      if (filterStatus) q.set("status", filterStatus)
      const res = await fetch(`/api/admin/accounting/forensic-failures?${q}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data: FailuresResponse = await res.json()
      setFailures(data.failures)
      setFailuresTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load failures")
      setFailures([])
    } finally {
      setLoadingFailures(false)
    }
  }, [runId, failuresPage, filterCheckId, filterBusinessId, filterSeverity, filterStatus])

  const updateFailureInList = (updated: Failure) => {
    setFailures((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))
  }

  const handleAcknowledge = async (f: Failure) => {
    setActionLoadingId(f.id)
    setError("")
    try {
      const res = await fetch(`/api/admin/accounting/forensic-failures/${f.id}/acknowledge`, { method: "PATCH" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      updateFailureInList(data.failure)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to acknowledge")
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleIgnore = async (f: Failure) => {
    setActionLoadingId(f.id)
    setError("")
    try {
      const res = await fetch(`/api/admin/accounting/forensic-failures/${f.id}/ignore`, { method: "PATCH" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      updateFailureInList(data.failure)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to ignore")
    } finally {
      setActionLoadingId(null)
    }
  }

  const openResolveModal = (f: Failure) => {
    setResolveModal({ open: true, failure: f, note: "" })
  }

  const handleResolveSubmit = async () => {
    const { failure, note } = resolveModal
    if (!failure || !note.trim()) return
    setActionLoadingId(failure.id)
    setError("")
    setSuccessMessage("")
    try {
      const res = await fetch(`/api/admin/accounting/forensic-failures/${failure.id}/resolve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution_note: note.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      updateFailureInList(data.failure)
      setResolveModal({ open: false, failure: null, note: "" })
      setSuccessMessage("Failure marked resolved.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resolution note is required and request failed")
    } finally {
      setActionLoadingId(null)
    }
  }

  const openEscalateModal = (f: Failure) => {
    setEscalateModal({ open: true, failure: f, reason: "", assignee: "" })
  }

  const handleEscalateSubmit = async () => {
    const { failure, reason, assignee } = escalateModal
    if (!failure || reason.trim().length < 10) return
    setActionLoadingId(failure.id)
    setError("")
    setSuccessMessage("")
    try {
      const res = await fetch(`/api/admin/accounting/forensic-failures/${failure.id}/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), assignee: assignee.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setEscalateModal({ open: false, failure: null, reason: "", assignee: "" })
      setSuccessMessage("Escalation recorded.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Escalation failed")
    } finally {
      setActionLoadingId(null)
    }
  }

  const payloadJournalEntryId = (payload: unknown): string | null => {
    if (payload && typeof payload === "object" && "journal_entry_id" in payload) {
      const v = (payload as { journal_entry_id?: string }).journal_entry_id
      return typeof v === "string" && v ? v : null
    }
    return null
  }

  const payloadReconciliationLink = (payload: unknown, businessId: string | null): string | null => {
    if (!businessId || !payload || typeof payload !== "object") return null
    const o = payload as Record<string, unknown>
    if ("scope_type" in o && "scope_id" in o && typeof o.scope_type === "string" && typeof o.scope_id === "string") {
      const base = buildAccountingRoute("/accounting/reconciliation", businessId)
      return `${base}${base.includes("?") ? "&" : "?"}scopeType=${encodeURIComponent(o.scope_type)}&scopeId=${encodeURIComponent(o.scope_id)}`
    }
    return null
  }

  useEffect(() => {
    loadRun()
  }, [loadRun])

  useEffect(() => {
    loadFailures()
  }, [loadFailures])

  const fetchPayload = async (failureId: string) => {
    if (payloadCache[failureId] !== undefined) return
    try {
      const res = await fetch(`/api/admin/accounting/forensic-failures/${failureId}`)
      if (!res.ok) return
      const { failure } = await res.json()
      setPayloadCache((prev) => ({ ...prev, [failureId]: failure.payload }))
    } catch {
      // ignore
    }
  }

  const togglePayload = (failureId: string) => {
    if (expandedPayloadId === failureId) {
      setExpandedPayloadId(null)
      return
    }
    setExpandedPayloadId(failureId)
    fetchPayload(failureId)
  }

  const formatDate = (s: string | null) =>
    s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—"

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case "open":
        return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
      case "acknowledged":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
      case "resolved":
        return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
      case "ignored":
        return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
    }
  }

  const duration =
    run?.started_at && run?.finished_at
      ? (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000
      : null

  if (forbidden) {
    return (
      <ProtectedLayout>
        <div className="p-6 max-w-2xl">
          <p className="text-red-600 dark:text-red-400">
            You don’t have access to forensic monitoring.
          </p>
          <Link href="/accounting" className="mt-4 inline-block text-blue-600 dark:text-blue-400 hover:underline">
            Back to Accounting
          </Link>
        </div>
      </ProtectedLayout>
    )
  }

  if (!runId) {
    return (
      <ProtectedLayout>
        <div className="p-6">Missing run ID.</div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-6">
          <Link
            href="/admin/accounting/forensic-runs"
            className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
          >
            ← Forensic Runs
          </Link>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3 rounded-md bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 text-sm">
            {successMessage}
          </div>
        )}

        {loadingRun ? (
          <p className="text-gray-500 dark:text-gray-400">Loading run…</p>
        ) : !run ? (
          <p className="text-gray-500 dark:text-gray-400">Run not found.</p>
        ) : (
          <>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                Run summary
              </h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">Run ID</dt>
                  <dd className="font-mono text-gray-900 dark:text-white break-all">{run.id}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">Status</dt>
                  <dd className="text-gray-900 dark:text-white">{run.status}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">Started</dt>
                  <dd className="text-gray-700 dark:text-gray-300">{formatDate(run.started_at)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">Finished</dt>
                  <dd className="text-gray-700 dark:text-gray-300">{formatDate(run.finished_at)}</dd>
                </div>
                {duration != null && (
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Duration</dt>
                    <dd className="text-gray-700 dark:text-gray-300">{duration.toFixed(2)}s</dd>
                  </div>
                )}
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">Total failures</dt>
                  <dd className="text-gray-900 dark:text-white">{run.summary?.total_failures ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">Alertable failures</dt>
                  <dd className="text-gray-900 dark:text-white">{run.summary?.alertable_failures ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">Alert sent</dt>
                  <dd className="text-gray-900 dark:text-white">{run.alert_sent ? "YES" : "NO"}</dd>
                </div>
              </dl>
              {run.summary?.check_counts && Object.keys(run.summary.check_counts).length > 0 && (
                <div className="mt-3">
                  <dt className="text-gray-500 dark:text-gray-400 text-sm mb-1">Check counts</dt>
                  <pre className="p-3 rounded bg-gray-50 dark:bg-gray-800 text-xs overflow-x-auto">
                    {JSON.stringify(run.summary.check_counts, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white p-4 pb-2">
                Failures
              </h2>
              <div className="px-4 py-2 flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="Filter by check_id"
                  value={filterCheckId}
                  onChange={(e) => setFilterCheckId(e.target.value)}
                  className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
                />
                <input
                  type="text"
                  placeholder="Filter by business_id"
                  value={filterBusinessId}
                  onChange={(e) => setFilterBusinessId(e.target.value)}
                  className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
                />
                <select
                  value={filterSeverity}
                  onChange={(e) => setFilterSeverity(e.target.value)}
                  className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
                >
                  <option value="">All severities</option>
                  <option value="alert">alert</option>
                  <option value="warning">warning</option>
                  <option value="info">info</option>
                </select>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
                >
                  <option value="">All statuses</option>
                  <option value="open">open</option>
                  <option value="acknowledged">acknowledged</option>
                  <option value="resolved">resolved</option>
                  <option value="ignored">ignored</option>
                </select>
                <button
                  type="button"
                  onClick={() => setFailuresPage(1)}
                  className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-sm"
                >
                  Apply
                </button>
              </div>
              {loadingFailures ? (
                <p className="p-4 text-gray-500 dark:text-gray-400 text-sm">Loading failures…</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-800/50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Check ID
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Business ID
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Severity
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Status
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Created
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Payload
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {failures.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400 text-sm">
                              No failures.
                            </td>
                          </tr>
                        ) : (
                          failures.map((f) => (
                            <tr key={f.id} className="bg-white dark:bg-gray-900">
                              <td className="px-4 py-2 text-sm font-mono text-gray-900 dark:text-white">
                                {f.check_id}
                              </td>
                              <td className="px-4 py-2 text-sm font-mono text-gray-600 dark:text-gray-400 truncate max-w-[140px]">
                                {f.business_id ?? "—"}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
                                {f.severity}
                              </td>
                              <td className="px-4 py-2">
                                <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(f.status ?? "open")}`}>
                                  {f.status ?? "open"}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                {formatDate(f.created_at)}
                              </td>
                              <td className="px-4 py-2">
                                <button
                                  type="button"
                                  onClick={() => togglePayload(f.id)}
                                  className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
                                >
                                  {expandedPayloadId === f.id ? "Hide" : "Expand"}
                                </button>
                              </td>
                              <td className="px-4 py-2">
                                {f.status === "open" && (
                                  <span className="flex flex-wrap gap-1">
                                    <button
                                      type="button"
                                      disabled={actionLoadingId === f.id}
                                      onClick={() => handleAcknowledge(f)}
                                      className="text-xs px-2 py-1 rounded border border-amber-600 dark:border-amber-500 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
                                    >
                                      Acknowledge
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoadingId === f.id}
                                      onClick={() => openEscalateModal(f)}
                                      className="text-xs px-2 py-1 rounded border border-blue-600 dark:border-blue-500 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
                                    >
                                      Escalate
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoadingId === f.id}
                                      onClick={() => handleIgnore(f)}
                                      className="text-xs px-2 py-1 rounded border border-gray-500 dark:border-gray-400 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                                    >
                                      Ignore
                                    </button>
                                  </span>
                                )}
                                {f.status === "acknowledged" && (
                                  <span className="flex flex-wrap gap-1">
                                    <button
                                      type="button"
                                      disabled={actionLoadingId === f.id}
                                      onClick={() => openResolveModal(f)}
                                      className="text-xs px-2 py-1 rounded border border-green-600 dark:border-green-500 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50"
                                    >
                                      Resolve
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoadingId === f.id}
                                      onClick={() => openEscalateModal(f)}
                                      className="text-xs px-2 py-1 rounded border border-blue-600 dark:border-blue-500 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
                                    >
                                      Escalate
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoadingId === f.id}
                                      onClick={() => handleIgnore(f)}
                                      className="text-xs px-2 py-1 rounded border border-gray-500 dark:border-gray-400 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                                    >
                                      Ignore
                                    </button>
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {expandedPayloadId && payloadCache[expandedPayloadId] !== undefined && (
                    <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800/50">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                        Payload (failure {expandedPayloadId})
                      </p>
                      {(() => {
                        const payload = payloadCache[expandedPayloadId]
                        const failure = failures.find((f) => f.id === expandedPayloadId)
                        const jeId = payloadJournalEntryId(payload)
                        const reconLink = payloadReconciliationLink(payload, failure?.business_id ?? null)
                        return (
                          <>
                            {(jeId || reconLink) && (
                              <div className="flex flex-wrap gap-2 mb-2">
                                {jeId && (
                                  <Link
                                    href={failure?.business_id ? `${buildAccountingRoute("/accounting/ledger", failure.business_id)}&journal_entry_id=${encodeURIComponent(jeId)}` : "/accounting"}
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                  >
                                    Open in Ledger →
                                  </Link>
                                )}
                                {reconLink && (
                                  <Link
                                    href={reconLink}
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                  >
                                    Open reconciliation →
                                  </Link>
                                )}
                              </div>
                            )}
                            <pre className="p-3 rounded bg-white dark:bg-gray-900 text-xs overflow-x-auto max-h-64 overflow-y-auto">
                              {JSON.stringify(payloadCache[expandedPayloadId], null, 2)}
                            </pre>
                          </>
                        )
                      })()}
                    </div>
                  )}
                  {failuresTotal > FAILURES_PAGE_SIZE && (
                    <div className="px-4 py-3 flex items-center justify-between border-t border-gray-200 dark:border-gray-700">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Page {failuresPage} of {Math.ceil(failuresTotal / FAILURES_PAGE_SIZE)} ({failuresTotal} failures)
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={failuresPage <= 1}
                          onClick={() => setFailuresPage((p) => p - 1)}
                          className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 text-sm"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          disabled={failuresPage >= Math.ceil(failuresTotal / FAILURES_PAGE_SIZE)}
                          onClick={() => setFailuresPage((p) => p + 1)}
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

            {resolveModal.open && resolveModal.failure && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
                <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Resolve failure</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    Check: {resolveModal.failure.check_id}. Provide a resolution note (required).
                  </p>
                  <textarea
                    value={resolveModal.note}
                    onChange={(e) => setResolveModal((prev) => ({ ...prev, note: e.target.value }))}
                    placeholder="Resolution note..."
                    rows={4}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-2 text-sm"
                  />
                  <div className="flex justify-end gap-2 mt-4">
                    <button
                      type="button"
                      onClick={() => setResolveModal({ open: false, failure: null, note: "" })}
                      className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!resolveModal.note.trim() || actionLoadingId === resolveModal.failure.id}
                      onClick={handleResolveSubmit}
                      className="px-3 py-1.5 rounded bg-green-600 text-white text-sm disabled:opacity-50 hover:bg-green-700"
                    >
                      Resolve
                    </button>
                  </div>
                </div>
              </div>
            )}

            {escalateModal.open && escalateModal.failure && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
                <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Escalate failure</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    Check: {escalateModal.failure.check_id}. Provide a reason (required, min 10 characters).
                  </p>
                  <textarea
                    value={escalateModal.reason}
                    onChange={(e) => setEscalateModal((prev) => ({ ...prev, reason: e.target.value }))}
                    placeholder="Reason for escalation..."
                    rows={4}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-2 text-sm"
                  />
                  <div className="mt-3">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Assignee (optional)</label>
                    <input
                      type="text"
                      value={escalateModal.assignee}
                      onChange={(e) => setEscalateModal((prev) => ({ ...prev, assignee: e.target.value }))}
                      placeholder="User ID or email"
                      className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-2 text-sm"
                    />
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <button
                      type="button"
                      onClick={() => setEscalateModal({ open: false, failure: null, reason: "", assignee: "" })}
                      className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={escalateModal.reason.trim().length < 10 || actionLoadingId === escalateModal.failure.id}
                      onClick={handleEscalateSubmit}
                      className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50 hover:bg-blue-700"
                    >
                      Escalate
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ProtectedLayout>
  )
}
