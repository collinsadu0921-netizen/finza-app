"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"

type ReadinessBlocker = {
  code: string
  title: string
  detail: string
  deepLink: string | null
}

type ReadinessWarning = {
  code: string
  title: string
  detail: string
  deepLink: string | null
}

type ReadinessResult = {
  status: "READY" | "BLOCKED" | "READY_WITH_WARNINGS"
  blockers: ReadinessBlocker[]
  warnings: ReadinessWarning[]
  computed_at: string
  period_id: string
  business_id: string
  firm_id: string | null
  snapshot_hash: string
}

type CloseRequestInfo = {
  has_active_request: boolean
  requested_at: string | null
  requested_by: string | null
  requested_by_email: string | null
  requested_by_name: string | null
}

type AccountingPeriod = {
  id: string
  business_id: string
  period_start: string
  period_end: string
  status: "open" | "closing" | "soft_closed" | "locked"
  closed_at: string | null
  closed_by: string | null
  close_requested_at: string | null
  close_requested_by: string | null
  closed_by_user?: {
    id: string
    email: string | null
    full_name: string | null
  } | null
}

type PeriodCloseCenterProps = {
  period: AccountingPeriod
  businessId: string
  onPeriodUpdate: () => void
  /** When false: show Soft close (owner path). When true or null: show Request close (firm path). */
  hasActiveEngagement?: boolean | null
}

export default function PeriodCloseCenter({
  period,
  businessId,
  onPeriodUpdate,
  hasActiveEngagement = null,
}: PeriodCloseCenterProps) {
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null)
  const [closeRequestInfo, setCloseRequestInfo] = useState<CloseRequestInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState("")
  const [confirmModal, setConfirmModal] = useState<"request_close" | "soft_close" | "approve_close" | "lock" | null>(null)
  const [confirmReconciliations, setConfirmReconciliations] = useState(false)

  useEffect(() => {
    loadReadiness()
    loadCloseRequestInfo()
  }, [period.id, businessId, period.period_start])

  const loadReadiness = async () => {
    try {
      const response = await fetch(
        `/api/accounting/periods/readiness?business_id=${businessId}&period_start=${period.period_start}`
      )
      if (!response.ok) {
        throw new Error("Failed to load readiness checks")
      }
      const data = await response.json()
      setReadiness(data.readiness)
    } catch (err: any) {
      console.error("Error loading readiness:", err)
      setError(err.message || "Failed to load readiness checks")
    } finally {
      setLoading(false)
    }
  }

  const loadCloseRequestInfo = async () => {
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "get_period_close_request_info",
        {
          p_business_id: businessId,
          p_period_start: period.period_start,
        }
      )

      if (rpcError) {
        console.error("Error loading close request info:", rpcError)
        return
      }

      if (data && data.length > 0) {
        setCloseRequestInfo(data[0])
      }
    } catch (err: any) {
      console.error("Error loading close request info:", err)
    }
  }

  const handleRequestClose = async () => {
    if (!readiness || readiness.status === "BLOCKED") {
      setError("Period cannot be closed due to blockers")
      return
    }

    setConfirmModal("request_close")
  }

  const submitRequestClose = async () => {
    if (!readiness || readiness.status === "BLOCKED") return

    try {
      setProcessing(true)
      setError("")
      setConfirmModal(null)
      setConfirmReconciliations(false)

      const response = await fetch("/api/accounting/periods/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          period_start: period.period_start,
          action: "request_close",
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        const failures = errorData.failures as Array<{ code: string; title: string; detail: string }> | undefined
        const msg = failures?.length
          ? `${errorData.error ?? "Period cannot be closed"}: ${failures.map((f: { title: string }) => f.title).join("; ")}`
          : (errorData.error || "Failed to request close")
        throw new Error(msg)
      }

      await onPeriodUpdate()
      await loadReadiness()
      await loadCloseRequestInfo()
    } catch (err: any) {
      setError(err.message || "Failed to request close")
    } finally {
      setProcessing(false)
    }
  }

  const handleSoftClose = async () => {
    if (!readiness || readiness.status === "BLOCKED") {
      setError("Period cannot be closed due to blockers")
      return
    }
    setConfirmModal("soft_close")
  }

  const submitSoftClose = async () => {
    if (!readiness || readiness.status === "BLOCKED") return
    try {
      setProcessing(true)
      setError("")
      setConfirmModal(null)
      setConfirmReconciliations(false)
      const response = await fetch("/api/accounting/periods/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          period_start: period.period_start,
          action: "soft_close",
        }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        const msg = errorData.error || "Failed to soft close"
        throw new Error(msg)
      }
      await onPeriodUpdate()
      await loadReadiness()
      await loadCloseRequestInfo()
    } catch (err: any) {
      setError(err.message || "Failed to soft close")
    } finally {
      setProcessing(false)
    }
  }

  const handleApproveClose = () => {
    setConfirmModal("approve_close")
  }

  const submitApproveClose = async () => {
    try {
      setProcessing(true)
      setError("")
      setConfirmModal(null)

      const response = await fetch("/api/accounting/periods/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          period_start: period.period_start,
          action: "approve_close",
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        const failures = errorData.failures as Array<{ code: string; title: string; detail: string }> | undefined
        const msg = failures?.length
          ? `${errorData.error ?? "Period cannot be closed"}: ${failures.map((f: { title: string }) => f.title).join("; ")}`
          : (errorData.error || "Failed to approve close")
        throw new Error(msg)
      }

      await onPeriodUpdate()
      await loadReadiness()
      await loadCloseRequestInfo()
    } catch (err: any) {
      setError(err?.message ?? "Failed to approve close")
    } finally {
      setProcessing(false)
    }
  }

  const handleRejectClose = async () => {
    try {
      setProcessing(true)
      setError("")

      const response = await fetch("/api/accounting/periods/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          period_start: period.period_start,
          action: "reject_close",
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to reject close")
      }

      await onPeriodUpdate()
      await loadReadiness()
      await loadCloseRequestInfo()
    } catch (err: any) {
      setError(err.message || "Failed to reject close")
    } finally {
      setProcessing(false)
    }
  }

  const handleLock = () => {
    setConfirmModal("lock")
  }

  const submitLock = async () => {
    try {
      setProcessing(true)
      setError("")
      setConfirmModal(null)

      const response = await fetch("/api/accounting/periods/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          period_start: period.period_start,
          action: "lock",
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        const failures = errorData.failures as Array<{ code: string; title: string; detail: string }> | undefined
        const msg = failures?.length
          ? `${errorData.error ?? "Period cannot be closed"}: ${failures.map((f: { title: string }) => f.title).join("; ")}`
          : (errorData.error || "Failed to lock period")
        throw new Error(msg)
      }

      await onPeriodUpdate()
      await loadReadiness()
    } catch (err: any) {
      setError(err?.message ?? "Failed to lock period")
    } finally {
      setProcessing(false)
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—"
    return new Date(dateString).toLocaleDateString("en-GH", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const formatPeriod = (periodStart: string): string => {
    const date = new Date(periodStart)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    return `${year}-${month}`
  }

  const getStatusBadge = (status: string) => {
    const styles = {
      open: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400 border border-green-300 dark:border-green-700",
      closing: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700",
      soft_closed: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400 border border-blue-300 dark:border-blue-700",
      locked: "bg-red-200 text-red-900 dark:bg-red-900/30 dark:text-red-300 border-2 border-red-500 dark:border-red-600 font-bold",
    }
    const labels = {
      open: "Open",
      closing: "Closing (Requested)",
      soft_closed: "Soft Closed",
      locked: "🔒 Locked",
    }
    return (
      <span
        className={`px-3 py-1 rounded-full text-xs font-semibold ${
          styles[status as keyof typeof styles] || styles.open
        }`}
      >
        {labels[status as keyof typeof labels] || status}
      </span>
    )
  }

  const isOpen = period.status === "open"
  const canSoftClose = isOpen && hasActiveEngagement === false && !processing
  const canRequestClose = isOpen && (hasActiveEngagement === true || hasActiveEngagement === null) && !processing
  const canApproveClose = period.status === "closing" && !processing
  const canRejectClose = period.status === "closing" && !processing
  const canLock = period.status === "soft_closed" && !processing
  const isLocked = period.status === "locked"
  const isClosing = period.status === "closing"

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
      {/* Period Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Period Close Center
          </h2>
          {getStatusBadge(period.status)}
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-600 dark:text-gray-400">Period:</span>
            <span className="ml-2 font-semibold text-gray-900 dark:text-white">
              {formatPeriod(period.period_start)}
            </span>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">Date Range:</span>
            <span className="ml-2 font-semibold text-gray-900 dark:text-white">
              {formatDate(period.period_start)} - {formatDate(period.period_end)}
            </span>
          </div>
        </div>
      </div>

      {/* Status Banners */}
      {isLocked && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 text-red-700 dark:text-red-400 px-4 py-3 rounded">
          <p className="font-semibold">🔒 Locked — Posting Blocked</p>
          <p className="text-sm mt-1">
            This period has been locked and is immutable. No new entries can be posted.
          </p>
          {period.closed_at && (
            <p className="text-sm mt-1">
              Locked at: {formatDate(period.closed_at)}
              {period.closed_by_user && (
                <> by {period.closed_by_user.full_name || period.closed_by_user.email}</>
              )}
            </p>
          )}
        </div>
      )}

      {isClosing && closeRequestInfo?.has_active_request && (
        <div className="mb-4 bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded">
          <p className="font-semibold">Close Requested</p>
          <p className="text-sm mt-1">
            Close requested by{" "}
            {closeRequestInfo.requested_by_name || closeRequestInfo.requested_by_email || "Unknown"}{" "}
            at {formatDate(closeRequestInfo.requested_at)}
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Readiness Checks */}
      {loading ? (
        <div className="mb-6 text-gray-500 dark:text-gray-400">Loading readiness checks...</div>
      ) : readiness ? (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            Readiness Status:{" "}
            <span
              className={
                readiness.status === "READY"
                  ? "text-green-600 dark:text-green-400"
                  : readiness.status === "BLOCKED"
                  ? "text-red-600 dark:text-red-400"
                  : "text-yellow-600 dark:text-yellow-400"
              }
            >
              {readiness.status.replace("_", " ")}
            </span>
          </h3>

          {/* Blockers */}
          {readiness.blockers.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2">
                Blockers (Must Fix):
              </h4>
              <ul className="list-disc list-inside space-y-2">
                {readiness.blockers.map((blocker, idx) => (
                  <li key={idx} className="text-sm text-red-600 dark:text-red-400">
                    <span className="font-semibold">{blocker.title}:</span> {blocker.detail}
                    {blocker.deepLink && (
                      <a
                        href={blocker.deepLink}
                        className="ml-2 text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        View →
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings */}
          {readiness.warnings.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-yellow-700 dark:text-yellow-400 mb-2">
                Warnings (Acknowledge):
              </h4>
              <ul className="list-disc list-inside space-y-2">
                {readiness.warnings.map((warning, idx) => (
                  <li key={idx} className="text-sm text-yellow-600 dark:text-yellow-400">
                    <span className="font-semibold">{warning.title}:</span> {warning.detail}
                    {warning.deepLink && (
                      <a
                        href={warning.deepLink}
                        className="ml-2 text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        View →
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {readiness.blockers.length === 0 && readiness.warnings.length === 0 && (
            <p className="text-sm text-green-600 dark:text-green-400">
              ✓ Period is ready to close with no blockers or warnings.
            </p>
          )}
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {canSoftClose && (
          <button
            onClick={handleSoftClose}
            disabled={processing || readiness?.status === "BLOCKED"}
            title={
              readiness?.status === "BLOCKED"
                ? "Resolve all accounting issues before closing this period."
                : undefined
            }
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Soft close
          </button>
        )}
        {canRequestClose && (
          <button
            onClick={handleRequestClose}
            disabled={processing || readiness?.status === "BLOCKED"}
            title={
              readiness?.status === "BLOCKED"
                ? "Resolve all accounting issues before closing this period."
                : undefined
            }
            className="px-4 py-2 text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700 dark:bg-yellow-700 dark:hover:bg-yellow-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Request Close
          </button>
        )}

        {canApproveClose && (
          <button
            onClick={() => handleApproveClose()}
            disabled={processing || readiness?.status === "BLOCKED"}
            title={
              readiness?.status === "BLOCKED"
                ? "Resolve all accounting issues before closing this period."
                : undefined
            }
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Approve Close
          </button>
        )}

        {canRejectClose && (
          <button
            onClick={handleRejectClose}
            disabled={processing}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reject Close
          </button>
        )}

        {canLock && (
          <button
            onClick={handleLock}
            disabled={processing}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Lock Period
          </button>
        )}

        {processing && (
          <span className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
            Processing...
          </span>
        )}

        {isLocked && (
          <span className="px-4 py-2 text-sm text-gray-400 dark:text-gray-500 italic">
            No actions available (locked)
          </span>
        )}
      </div>

      {/* Confirm modals */}
      {confirmModal === "soft_close" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Soft close</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              This will soft-close the period. No further posting until you lock or reopen. Ensure reconciliations are complete.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitSoftClose}
                disabled={processing}
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50 hover:bg-blue-700"
              >
                Soft close
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmModal === "request_close" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Request close</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Ensure all reconciliations are complete. Closing will prevent further posting in this period.
            </p>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-4">
              <input
                type="checkbox"
                checked={confirmReconciliations}
                onChange={(e) => setConfirmReconciliations(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              I confirm reconciliations are complete
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setConfirmModal(null); setConfirmReconciliations(false) }}
                className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRequestClose}
                disabled={processing}
                className="px-3 py-1.5 rounded bg-yellow-600 text-white text-sm disabled:opacity-50 hover:bg-yellow-700"
              >
                Request close
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmModal === "approve_close" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Approve close (soft close)</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              This will soft-close the period. Posting will be blocked until the period is locked or reopened. Ensure reconciliations are complete.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitApproveClose}
                disabled={processing}
                className="px-3 py-1.5 rounded bg-green-600 text-white text-sm disabled:opacity-50 hover:bg-green-700"
              >
                Approve close
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmModal === "lock" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Lock period</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Locking makes the period immutable. No further posting or changes are allowed. Ensure all reconciliations are complete before locking.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitLock}
                disabled={processing}
                className="px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-50 hover:bg-red-700"
              >
                Lock period
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
