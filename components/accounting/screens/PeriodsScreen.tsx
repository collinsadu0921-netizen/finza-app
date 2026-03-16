"use client"

import React, { useState, useEffect } from "react"
import EmptyState from "@/components/ui/EmptyState"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getUserRole } from "@/lib/userRoles"
import {
  useAccountingReadiness,
  ACCOUNTING_NOT_INITIALIZED_TITLE,
  ACCOUNTING_NOT_INITIALIZED_DESCRIPTION,
  ACCOUNTING_NOT_INITIALIZED_ACCOUNTANT_SECONDARY,
} from "@/lib/accounting/useAccountingReadiness"
import ReadinessBanner from "@/components/accounting/ReadinessBanner"
import PeriodCloseCenter from "@/components/PeriodCloseCenter"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { buildServiceRoute } from "@/lib/service/routes"
import type { ScreenProps } from "./types"

type ClosedByUser = {
  id: string
  email: string | null
  full_name: string | null
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
  closed_by_user: ClosedByUser | null
  created_at: string
}

export default function PeriodsScreen({ mode, businessId }: ScreenProps) {
  const router = useRouter()
  const { ready, authority_source, loading: readinessLoading, refetch: refetchReadiness } = useAccountingReadiness(businessId)
  const noContext = !businessId
  const [loading, setLoading] = useState(true)
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [error, setError] = useState("")
  const [processingPeriodId, setProcessingPeriodId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [reopenModal, setReopenModal] = useState<{
    open: boolean
    period: AccountingPeriod | null
    reason: string
  }>({
    open: false,
    period: null,
    reason: "",
  })
  const [expandedPeriodId, setExpandedPeriodId] = useState<string | null>(null)
  const [readinessChecks, setReadinessChecks] = useState<{
    [periodId: string]: {
      loading: boolean
      checked: boolean
      ok: boolean
      failures: Array<{
        code: string
        title: string
        detail: string
        scope?: { type: "invoice" | "customer" | "period"; id?: string }
      }>
      checked_at: string | null
    }
  }>({})
  const [checkingReadinessId, setCheckingReadinessId] = useState<string | null>(null)
  const [hasActiveEngagement, setHasActiveEngagement] = useState<boolean | null>(null)

  useEffect(() => {
    if (!businessId) {
      setLoading(false)
      return
    }
  }, [businessId])

  useEffect(() => {
    if (!businessId) return
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) getUserRole(supabase, user.id, businessId).then(setUserRole)
    })
  }, [businessId])

  useEffect(() => {
    if (businessId) {
      loadPeriods()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  useEffect(() => {
    if (!businessId) {
      setHasActiveEngagement(null)
      return
    }
    let cancelled = false
    fetch(`/api/accounting/periods/has-active-engagement?business_id=${encodeURIComponent(businessId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to check engagement"))))
      .then((data: { has_active_engagement?: boolean }) => {
        if (!cancelled) setHasActiveEngagement(Boolean(data?.has_active_engagement))
      })
      .catch(() => {
        if (!cancelled) setHasActiveEngagement(null)
      })
    return () => { cancelled = true }
  }, [businessId])

  const loadPeriods = async () => {
    if (!businessId) return
    try {
      setLoading(true)
      setError("")
      const response = await fetch(`/api/accounting/periods?business_id=${businessId}`)
      
      if (!response.ok) {
        // Parse error response for better error messages
        let errorMessage = "Failed to load accounting periods"
        try {
          const errorData = await response.json()
          if (response.status === 400) {
            errorMessage = "Business context missing. Please refresh the page."
          } else if (response.status === 403) {
            errorMessage = "You do not have accountant access to this business."
          } else if (response.status === 500) {
            errorMessage = "Server error loading periods. Please try again later."
          } else if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch {
          // If JSON parsing fails, use status-based message
          if (response.status === 400) {
            errorMessage = "Business context missing. Please refresh the page."
          } else if (response.status === 403) {
            errorMessage = "You do not have accountant access to this business."
          } else if (response.status === 500) {
            errorMessage = "Server error loading periods. Please try again later."
          }
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()
      setPeriods(data.periods || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load accounting periods")
      setLoading(false)
    }
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
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${styles[status as keyof typeof styles] || styles.open}`}>
        {labels[status as keyof typeof labels] || status}
      </span>
    )
  }

  const formatDate = (dateString: string) => {
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

  const formatClosedBy = (period: AccountingPeriod): string => {
    if (!period.closed_by_user) {
      return "—"
    }
    if (period.closed_by_user.full_name) {
      return period.closed_by_user.full_name
    }
    if (period.closed_by_user.email) {
      return period.closed_by_user.email
    }
    return "Unknown User"
  }

  const handleSoftClose = async (period: AccountingPeriod) => {
    if (!businessId || period.status !== "open") return

    try {
      setProcessingPeriodId(period.id)
      setError("")

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
        throw new Error(errorData.error || "Failed to close period")
      }

      // Reload periods to reflect new status
      await loadPeriods()
    } catch (err: any) {
      setError(err.message || "Failed to close period")
    } finally {
      setProcessingPeriodId(null)
    }
  }

  const handleLock = async (period: AccountingPeriod) => {
    if (!businessId || period.status !== "soft_closed") return

    try {
      setProcessingPeriodId(period.id)
      setError("")

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
        throw new Error(errorData.error || "Failed to lock period")
      }

      // Reload periods to reflect new status
      await loadPeriods()
    } catch (err: any) {
      setError(err.message || "Failed to lock period")
    } finally {
      setProcessingPeriodId(null)
    }
  }

  const handleReopen = async () => {
    const period = reopenModal.period
    if (!businessId || !period || period.status !== "soft_closed") return

    // Validate reason is provided and min length
    if (!reopenModal.reason.trim()) {
      setError("Reason is required for reopening a period")
      return
    }
    if (reopenModal.reason.trim().length < 10) {
      setError("Reason must be at least 10 characters")
      return
    }

    try {
      setProcessingPeriodId(period.id)
      setError("")

      const response = await fetch("/api/accounting/periods/reopen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          period_start: period.period_start,
          reason: reopenModal.reason.trim(),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to reopen period")
      }

      // Close modal and reload periods
      setReopenModal({ open: false, period: null, reason: "" })
      await loadPeriods()
    } catch (err: any) {
      setError(err.message || "Failed to reopen period")
    } finally {
      setProcessingPeriodId(null)
    }
  }

  const openReopenModal = (period: AccountingPeriod) => {
    setReopenModal({
      open: true,
      period,
      reason: "",
    })
  }

  const closeReopenModal = () => {
    setReopenModal({
      open: false,
      period: null,
      reason: "",
    })
    setError("")
  }

  const handleCheckReadiness = async (period: AccountingPeriod) => {
    if (!businessId) return

    setCheckingReadinessId(period.id)
    setReadinessChecks((prev) => ({
      ...prev,
      [period.id]: {
        loading: true,
        checked: false,
        ok: false,
        failures: [],
        checked_at: null,
      },
    }))

    try {
      const response = await fetch(
        `/api/accounting/periods/audit-readiness?businessId=${encodeURIComponent(businessId)}&periodId=${encodeURIComponent(period.id)}`
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to check readiness")
      }

      const data = await response.json()
      setReadinessChecks((prev) => ({
        ...prev,
        [period.id]: {
          loading: false,
          checked: true,
          ok: data.ok === true,
          failures: data.failures ?? [],
          checked_at: data.checked_at ?? new Date().toISOString(),
        },
      }))
    } catch (err: any) {
      setError(err.message || "Failed to check readiness")
      setReadinessChecks((prev) => ({
        ...prev,
        [period.id]: {
          loading: false,
          checked: true,
          ok: false,
          failures: [
            {
              code: "CHECK_ERROR",
              title: "Readiness check failed",
              detail: err.message || "Failed to check readiness",
            },
          ],
          checked_at: new Date().toISOString(),
        },
      }))
    } finally {
      setCheckingReadinessId(null)
    }
  }

  const getReadinessLinkForFailure = (failure: {
    code: string
    scope?: { type: "invoice" | "customer" | "period"; id?: string }
  }): string | null => {
    if (failure.code === "UNRESOLVED_AR_MISMATCHES" || failure.code === "AR_RECONCILIATION_MISMATCH") {
      return "/accounting/reconciliation"
    }
    if (failure.code === "TRIAL_BALANCE_UNBALANCED") {
      return "/accounting/reports/trial-balance"
    }
    if (failure.scope?.type === "invoice" && failure.scope.id) {
      return `/invoices/${failure.scope.id}/view`
    }
    if (failure.scope?.type === "customer" && failure.scope.id) {
      return `/customers/${failure.scope.id}`
    }
    return null
  }

  const backUrl = mode === "service" ? buildServiceRoute("/service/accounting", businessId) : (businessId ? `/accounting?business_id=${businessId}` : "/accounting")

  const readinessFailureHref = (link: string | null): string | null => {
    if (!link) return null
    if (!link.startsWith("/accounting")) return link
    const servicePath = link.replace("/accounting/reports/", "/service/reports/").replace("/accounting/", "/service/accounting/")
    return mode === "service" ? buildServiceRoute(servicePath, businessId) : (businessId ? buildAccountingRoute(link, businessId) : "/accounting")
  }

  if (readinessLoading || loading) {
    return (
      
        <div className="p-6">
          <p>Loading...</p>
        </div>
      
    )
  }

  if (noContext) {
    return (
      
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <EmptyState
            title="Client not selected"
            description="Select a client or business to view accounting periods."
          />
        </div>
      
    )
  }

  if (authority_source === "accountant" && ready === false) {
    return (
      
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <EmptyState
            title={ACCOUNTING_NOT_INITIALIZED_TITLE}
            description={ACCOUNTING_NOT_INITIALIZED_DESCRIPTION}
          />
          <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
            {ACCOUNTING_NOT_INITIALIZED_ACCOUNTANT_SECONDARY}
          </p>
        </div>
      
    )
  }

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <ReadinessBanner
            ready={ready}
            authoritySource={authority_source}
            businessId={businessId}
            onInitSuccess={refetchReadiness}
          />
          <div className="flex justify-between items-center mb-8">
            <div>
              <button
                onClick={() => router.push(backUrl)}
                className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
              >
                ← Back to Accounting
              </button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Accounting Periods
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">Manage accounting period status and locking</p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Periods Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      Period
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      Start Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      End Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      Closed At
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      Closed By
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {periods.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                        No accounting periods found
                      </td>
                    </tr>
                  ) : (
                    periods.map((period) => {
                      const isLocked = period.status === "locked"
                      const isProcessing = processingPeriodId === period.id
                      const isExpanded = expandedPeriodId === period.id
                      const canReopen = 
                        period.status === "soft_closed" && 
                        !isProcessing &&
                        (userRole === "admin" || userRole === "owner")
                      const canCheckReadiness = period.status === "open" || period.status === "closing"
                      const isCheckingReadiness = checkingReadinessId === period.id
                      const readiness = readinessChecks[period.id]
                      const hasCheckedReadiness = readiness?.checked === true
                      const isReadinessBlocked = hasCheckedReadiness && !readiness.ok

                      return (
                        <React.Fragment key={period.id}>
                          <tr
                            className={`transition-colors ${
                              isLocked
                                ? "bg-red-50 dark:bg-red-900/10 border-l-4 border-red-500"
                                : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                            }`}
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                              {formatPeriod(period.period_start)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                              {formatDate(period.period_start)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                              {formatDate(period.period_end)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              {getStatusBadge(period.status)}
                              {isLocked && (
                                <span className="ml-2 text-xs text-red-600 dark:text-red-400 font-medium">
                                  (Immutable)
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                              {period.closed_at ? formatDate(period.closed_at) : "—"}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                              {formatClosedBy(period)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <div className="flex gap-2 flex-wrap">
                                {canCheckReadiness && (
                                  <button
                                    onClick={() => handleCheckReadiness(period)}
                                    disabled={isCheckingReadiness || isProcessing}
                                    className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {isCheckingReadiness ? "Checking..." : "Check readiness"}
                                  </button>
                                )}
                                <button
                                  onClick={() => setExpandedPeriodId(isExpanded ? null : period.id)}
                                  className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 border border-blue-300 dark:border-blue-600 rounded-md transition-colors"
                                >
                                  {isExpanded ? "Hide" : "Close Center"}
                                </button>
                                {canReopen && (
                                  <button
                                    onClick={() => openReopenModal(period)}
                                    disabled={isProcessing}
                                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    Reopen
                                  </button>
                                )}
                                {isProcessing && (
                                  <span className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">
                                    Processing...
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Inline Readiness Panel */}
                          {hasCheckedReadiness && !isExpanded && (
                            <tr key={`${period.id}-readiness`}>
                              <td colSpan={7} className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50">
                                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                                  {/* Readiness Badge */}
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                      {readiness.ok ? (
                                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border border-green-300 dark:border-green-700">
                                          ✓ Ready to close
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border border-red-300 dark:border-red-700">
                                          ✗ Not ready to close
                                        </span>
                                      )}
                                      {readiness.checked_at && (
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                          Checked at {new Date(readiness.checked_at).toLocaleTimeString()}
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => handleCheckReadiness(period)}
                                      disabled={isCheckingReadiness}
                                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                                    >
                                      Re-check
                                    </button>
                                  </div>

                                  {/* Success Message */}
                                  {readiness.ok && (
                                    <p className="text-sm text-green-700 dark:text-green-400">
                                      All accounting checks passed. This period can be safely closed.
                                    </p>
                                  )}

                                  {/* Failure Cards */}
                                  {!readiness.ok && readiness.failures.length > 0 && (
                                    <div className="space-y-3">
                                      {readiness.failures.map((failure, idx) => {
                                        const link = getReadinessLinkForFailure(failure)
                                        const href = readinessFailureHref(link)
                                        return (
                                          <div
                                            key={idx}
                                            className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3"
                                          >
                                            <div className="flex items-start justify-between gap-2">
                                              <div>
                                                <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                                                  {failure.title}
                                                </p>
                                                <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                                                  {failure.detail}
                                                </p>
                                              </div>
                                              {href && (
                                                <a
                                                  href={href}
                                                  className="shrink-0 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-700 rounded-md transition-colors"
                                                >
                                                  Resolve →
                                                </a>
                                              )}
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}

                                  {/* Tooltip for blocked close */}
                                  {isReadinessBlocked && (
                                    <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 italic">
                                      Resolve all accounting issues before closing this period.
                                    </p>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}

                          {isExpanded && (
                            <tr key={`${period.id}-close-center`}>
                              <td colSpan={7} className="px-6 py-4">
                                <PeriodCloseCenter
                                  period={period}
                                  businessId={businessId!}
                                  onPeriodUpdate={loadPeriods}
                                  hasActiveEngagement={hasActiveEngagement}
                                />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Reopen Confirmation Modal */}
      {reopenModal.open && reopenModal.period && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Reopen Accounting Period
            </h2>
            <div className="mb-4">
              <p className="text-gray-700 dark:text-gray-300 mb-2">
                Period: <span className="font-semibold">{formatPeriod(reopenModal.period.period_start)}</span>
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3 mb-4">
                ⚠️ Reopening allows posting into a previously closed period. This action is auditable and requires a reason (min 10 characters).
              </p>
            </div>
            <div className="mb-6">
              <label htmlFor="reopen-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Reason for reopening <span className="text-red-500">*</span>
              </label>
              <textarea
                id="reopen-reason"
                value={reopenModal.reason}
                onChange={(e) =>
                  setReopenModal({
                    ...reopenModal,
                    reason: e.target.value,
                  })
                }
                placeholder="Enter reason for reopening this period (required, min 10 characters)"
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                required
              />
              {reopenModal.reason.trim().length > 0 && reopenModal.reason.trim().length < 10 && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  {10 - reopenModal.reason.trim().length} more character(s) required
                </p>
              )}
            </div>
            <div className="flex gap-4">
              <button
                onClick={closeReopenModal}
                disabled={processingPeriodId === reopenModal.period?.id}
                className="flex-1 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-4 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleReopen}
                disabled={
                  processingPeriodId === reopenModal.period?.id ||
                  !reopenModal.reason.trim() ||
                  reopenModal.reason.trim().length < 10
                }
                className="flex-1 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white px-4 py-3 rounded-lg font-medium shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processingPeriodId === reopenModal.period?.id ? "Processing..." : "Confirm Reopen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


