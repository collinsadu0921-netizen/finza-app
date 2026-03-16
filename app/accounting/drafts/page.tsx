"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import EmptyState from "@/components/ui/EmptyState"
import { useRouter } from "next/navigation"
import { getActiveFirmId } from "@/lib/firmSession"
import AccountingBreadcrumbs from "@/components/AccountingBreadcrumbs"
import { useAccountingBusiness } from "@/lib/accounting/useAccountingBusiness"

type DraftStatus = "draft" | "submitted" | "approved" | "rejected"

type Draft = {
  id: string
  status: DraftStatus
  entry_date: string
  description: string
  total_debit: number
  total_credit: number
  lines: Array<{
    account_id: string
    debit: number
    credit: number
    memo?: string
  }>
  created_by: string | null
  submitted_by: string | null
  approved_by: string | null
  rejected_by: string | null
  created_at: string
  submitted_at: string | null
  approved_at: string | null
  rejected_at: string | null
  rejection_reason: string | null
  journal_entry_id: string | null
  posted_at: string | null
  posted_by: string | null
  period_id: string
  accounting_periods: {
    period_start: string
    period_end: string
    status: string
  } | null
  created_by_name: string | null
  submitted_by_name: string | null
  approved_by_name: string | null
  rejected_by_name: string | null
  posted_by_name: string | null
}

type AccountingPeriod = {
  id: string
  period_start: string
  period_end: string
  status: string
}

const CLIENT_NOT_SELECTED_MESSAGE =
  "Client not selected. Please choose a client or use a Control Tower drill link."

export default function DraftsPage() {
  const router = useRouter()
  const { businessId, loading: contextLoading, error: contextError } = useAccountingBusiness()
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [error, setError] = useState("")
  const [firmId, setFirmId] = useState<string | null>(null)
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [periodFilter, setPeriodFilter] = useState<string>("")
  const [startDateFilter, setStartDateFilter] = useState<string>("")
  const [endDateFilter, setEndDateFilter] = useState<string>("")

  useEffect(() => {
    setFirmId(getActiveFirmId())
  }, [])

  useEffect(() => {
    if (firmId && businessId) {
      loadPeriods()
      loadDrafts()
    }
  }, [firmId, businessId, statusFilter, periodFilter, startDateFilter, endDateFilter])

  const loadPeriods = async () => {
    if (!businessId) return

    try {
      const response = await fetch(`/api/accounting/periods?business_id=${businessId}`)
      if (!response.ok) {
        throw new Error("Failed to load periods")
      }

      const data = await response.json()
      setPeriods(data.periods || [])
    } catch (err: any) {
      console.error("Error loading periods:", err)
    }
  }

  const loadDrafts = async () => {
    if (!firmId || !businessId) return

    try {
      setLoading(true)
      const params = new URLSearchParams({
        firm_id: firmId,
        client_business_id: businessId,
      })

      if (statusFilter !== "all") {
        params.append("status", statusFilter)
      }

      if (periodFilter) {
        params.append("period_id", periodFilter)
      }

      if (startDateFilter) {
        params.append("start_date", startDateFilter)
      }

      if (endDateFilter) {
        params.append("end_date", endDateFilter)
      }

      const response = await fetch(`/api/accounting/drafts?${params.toString()}`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to load drafts")
      }

      const data = await response.json()
      setDrafts(data.drafts || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load drafts")
      setLoading(false)
    }
  }

  const getStatusBadge = (status: DraftStatus) => {
    const badges = {
      draft: "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200",
      submitted: "bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-400",
      approved: "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400",
      rejected: "bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-400",
    }
    return badges[status] || badges.draft
  }

  const formatPeriod = (periodStart: string): string => {
    const date = new Date(periodStart)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    return `${year}-${month}`
  }

  const formatCurrency = (amount: number): string => {
    return amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  if (contextLoading) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  if (contextError || !businessId) {
    return (
      <ProtectedLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <EmptyState
            title="Client not selected"
            description={contextError || CLIENT_NOT_SELECTED_MESSAGE}
          />
        </div>
      </ProtectedLayout>
    )
  }

  if (loading && drafts.length === 0) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Loading drafts...</p>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <AccountingBreadcrumbs />

          <div className="flex justify-between items-center mb-8">
            <div>
              <button
                onClick={() => router.push(businessId ? `/accounting?business_id=${businessId}` : "/accounting")}
                className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
              >
                ← Back to Accounting
              </button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Manual Journal Drafts
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Create, review, and manage manual journal entry drafts
              </p>
            </div>
            <button
              onClick={() =>
                router.push(
                  businessId ? `/accounting/drafts/new?business_id=${businessId}` : "/accounting/drafts/new"
                )
              }
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white font-medium rounded-lg shadow-lg transition-colors"
            >
              + New Draft
            </button>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Filters</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="all">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Period
                </label>
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">All Periods</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {formatPeriod(period.period_start)} ({period.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDateFilter}
                  onChange={(e) => setStartDateFilter(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDateFilter}
                  onChange={(e) => setEndDateFilter(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Drafts Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                Drafts ({drafts.length})
              </h2>

              {drafts.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 dark:text-gray-400">No drafts found</p>
                  <button
                    onClick={() =>
                      router.push(
                        businessId
                          ? `/accounting/drafts/new?business_id=${businessId}`
                          : "/accounting/drafts/new"
                      )
                    }
                    className="mt-4 px-4 py-2 text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Create your first draft
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Description
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Period
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Status
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Total
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Created By
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {drafts.map((draft) => (
                        <tr
                          key={draft.id}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                          onClick={() =>
                            router.push(
                              businessId
                                ? `/accounting/drafts/${draft.id}?business_id=${businessId}`
                                : `/accounting/drafts/${draft.id}`
                            )
                          }
                        >
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                            {new Date(draft.entry_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                            {draft.description}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                            {draft.accounting_periods
                              ? formatPeriod(draft.accounting_periods.period_start)
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(
                                draft.status
                              )}`}
                            >
                              {draft.status.charAt(0).toUpperCase() + draft.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-medium text-gray-900 dark:text-white">
                            {formatCurrency(draft.total_debit)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                            {draft.created_by_name || "Unknown"}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                router.push(
                                  businessId
                                    ? `/accounting/drafts/${draft.id}?business_id=${businessId}`
                                    : `/accounting/drafts/${draft.id}`
                                )
                              }}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-medium"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
