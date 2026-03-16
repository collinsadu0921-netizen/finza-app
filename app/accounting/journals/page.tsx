"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import EmptyState from "@/components/ui/EmptyState"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getActiveEngagement } from "@/lib/firmEngagements"
import { checkFirmOnboardingForAction } from "@/lib/firmOnboarding"
import {
  useAccountingBusiness,
  CLIENT_NOT_SELECTED_DESCRIPTION,
} from "@/lib/accounting/useAccountingBusiness"

type DraftStatus = "draft" | "submitted" | "approved" | "rejected"

type AccountingPeriod = {
  id: string
  period_start: string
  period_end: string
  status: "open" | "soft_closed" | "locked"
}

type UserInfo = {
  id: string
  email: string | null
  raw_user_meta_data: {
    full_name?: string
  } | null
}

type ManualJournalDraft = {
  id: string
  entry_date: string
  description: string
  status: DraftStatus
  total_debit: number
  total_credit: number
  created_by: string
  created_at: string
  updated_at: string
  created_by_user: UserInfo | null
  period: AccountingPeriod | null
  journal_entry_id: string | null
}

export default function ManualJournalDraftsPage() {
  const router = useRouter()
  const { businessId: clientBusinessId, loading: contextLoading, error: contextError } = useAccountingBusiness()
  const [loading, setLoading] = useState(true)
  const [firmId, setFirmId] = useState<string | null>(null)
  const [firmName, setFirmName] = useState<string | null>(null)
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("")
  const [drafts, setDrafts] = useState<ManualJournalDraft[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [error, setError] = useState("")
  const [blocked, setBlocked] = useState(false)
  const [blockedReason, setBlockedReason] = useState("")

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [createdByFilter, setCreatedByFilter] = useState<string>("all")
  const [dateFrom, setDateFrom] = useState<string>("")
  const [dateTo, setDateTo] = useState<string>("")

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 50

  useEffect(() => {
    if (!clientBusinessId) return
    initializePage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientBusinessId])

  useEffect(() => {
    if (clientBusinessId && selectedPeriodId) {
      loadDrafts()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientBusinessId, selectedPeriodId, statusFilter, createdByFilter, dateFrom, dateTo, currentPage])

  const initializePage = async () => {
    if (!clientBusinessId) return
    try {
      setLoading(true)
      setError("")
      setBlocked(false)
      setBlockedReason("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not authenticated")
        setLoading(false)
        return
      }

      const onboardingCheck = await checkFirmOnboardingForAction(
        supabase,
        user.id,
        clientBusinessId
      )

      if (!onboardingCheck.isComplete || !onboardingCheck.firmId) {
        setBlocked(true)
        setBlockedReason("Firm onboarding required or no firm found.")
        setLoading(false)
        return
      }

      setFirmId(onboardingCheck.firmId)

      const { data: firm } = await supabase
        .from("accounting_firms")
        .select("legal_name")
        .eq("id", onboardingCheck.firmId)
        .single()

      if (firm) {
        setFirmName(firm.legal_name)
      }

      const engagement = await getActiveEngagement(
        supabase,
        onboardingCheck.firmId,
        clientBusinessId
      )

      if (!engagement) {
        setBlocked(true)
        setBlockedReason("An active engagement is required to view manual journal drafts.")
        setLoading(false)
        return
      }

      await loadPeriods(clientBusinessId)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to initialize page")
      setLoading(false)
    }
  }

  const loadPeriods = async (businessId: string) => {
    try {
      const response = await fetch(`/api/accounting/periods?business_id=${businessId}`)
      if (!response.ok) {
        throw new Error("Failed to load periods")
      }

      const data = await response.json()
      const periodsList = (data.periods || []) as AccountingPeriod[]
      setPeriods(periodsList)

      // Auto-select first period if available
      if (periodsList.length > 0 && !selectedPeriodId) {
        setSelectedPeriodId(periodsList[0].id)
      }
    } catch (err: any) {
      console.error("Error loading periods:", err)
    }
  }

  const loadDrafts = async () => {
    if (!clientBusinessId || !selectedPeriodId) {
      setDrafts([])
      setTotalCount(0)
      return
    }

    try {
      setLoading(true)
      const params = new URLSearchParams({
        client_business_id: clientBusinessId,
        period_id: selectedPeriodId,
        limit: pageSize.toString(),
        offset: ((currentPage - 1) * pageSize).toString(),
      })

      if (statusFilter !== "all") {
        params.append("status", statusFilter)
      }

      if (createdByFilter !== "all") {
        params.append("created_by", createdByFilter)
      }

      if (dateFrom) {
        params.append("entry_date_from", dateFrom)
      }

      if (dateTo) {
        params.append("entry_date_to", dateTo)
      }

      const response = await fetch(`/api/accounting/journals/drafts?${params}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || "Failed to load drafts")
      }

      const data = await response.json()
      setDrafts(data.drafts || [])
      setTotalCount(data.count || 0)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load drafts")
      setLoading(false)
    }
  }

  const handleFilterChange = () => {
    setCurrentPage(1) // Reset pagination on filter change
  }

  const getStatusBadge = (status: DraftStatus) => {
    const styles = {
      draft: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600",
      submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400 border border-blue-300 dark:border-blue-700",
      approved: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400 border border-green-300 dark:border-green-700",
      rejected: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400 border border-red-300 dark:border-red-700",
    }
    const labels = {
      draft: "Draft",
      submitted: "Submitted",
      approved: "Approved",
      rejected: "Rejected",
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold ${styles[status]}`}>
        {labels[status]}
      </span>
    )
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—"
    return new Date(dateString).toLocaleDateString()
  }

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return "—"
    return new Date(dateString).toLocaleString()
  }

  const getUserDisplayName = (user: UserInfo | null) => {
    if (!user) return "—"
    if (user.raw_user_meta_data?.full_name) {
      return user.raw_user_meta_data.full_name
    }
    return user.email || "—"
  }

  const isImbalanced = (draft: ManualJournalDraft) => {
    return Math.abs(draft.total_debit - draft.total_credit) >= 0.01
  }

  const isLocked = (draft: ManualJournalDraft) => {
    return draft.status === "approved" || draft.status === "rejected"
  }

  const formatPeriod = (period: AccountingPeriod | null) => {
    if (!period) return "—"
    const start = new Date(period.period_start)
    return `${start.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
  }

  if (contextLoading || loading) {
    return (
      <ProtectedLayout>
        <LoadingScreen />
      </ProtectedLayout>
    )
  }

  if (contextError) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <PageHeader title="Manual Journal Drafts" />
            <EmptyState
              title="Client not selected"
              description={CLIENT_NOT_SELECTED_DESCRIPTION}
            />
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  if (blocked) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <PageHeader title="Manual Journal Drafts" />
            <EmptyState
              title="Access Blocked"
              description={blockedReason}
            />
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  const totalPages = Math.ceil(totalCount / pageSize)
  const uniqueCreators = Array.from(
    new Set(drafts.map((d) => d.created_by).filter(Boolean))
  )

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageHeader
            title="Manual Journal Drafts"
            subtitle={
              <div className="flex gap-4 mt-2">
                {firmName && (
                  <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-400 rounded-full text-sm font-medium">
                    Firm: {firmName}
                  </span>
                )}
                {clientBusinessId && (
                  <span className="px-3 py-1 bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400 rounded-full text-sm font-medium">
                    Client: {clientBusinessId.slice(0, 8)}…
                  </span>
                )}
                {selectedPeriodId && (
                  <span className="px-3 py-1 bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-400 rounded-full text-sm font-medium">
                    Period: {formatPeriod(periods.find((p) => p.id === selectedPeriodId) ?? null)}
                  </span>
                )}
              </div>
            }
          />

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Filters Panel */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Period Selector (Required) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Period <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedPeriodId}
                  onChange={(e) => {
                    setSelectedPeriodId(e.target.value)
                    handleFilterChange()
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select Period</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {formatPeriod(period)} ({period.status})
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value)
                    handleFilterChange()
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>

              {/* Created By Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Created By
                </label>
                <select
                  value={createdByFilter}
                  onChange={(e) => {
                    setCreatedByFilter(e.target.value)
                    handleFilterChange()
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Users</option>
                  {uniqueCreators.length > 0 && uniqueCreators.map((userId) => {
                    const draft = drafts.find((d) => d.created_by === userId)
                    return (
                      <option key={userId} value={userId}>
                        {getUserDisplayName(draft?.created_by_user || null)}
                      </option>
                    )
                  })}
                </select>
              </div>

              {/* Entry Date Range */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Entry Date From
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value)
                    handleFilterChange()
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Date To */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Entry Date To
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  handleFilterChange()
                }}
                className="w-full md:w-1/4 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Table */}
          {!selectedPeriodId ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12">
              <p className="text-center text-gray-600 dark:text-gray-400">
                Please select a period to view drafts.
              </p>
            </div>
          ) : drafts.length === 0 ? (
            <EmptyState
              title="No drafts found"
              description="No manual journal drafts found for the selected period."
            />
          ) : (
            <>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Entry Date
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Description
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Total Debit
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Total Credit
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Created By
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Last Updated
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {drafts.map((draft) => (
                        <tr
                          key={draft.id}
                          onClick={() => router.push(`/accounting/journals/drafts/${draft.id}?business_id=${clientBusinessId}`)}
                          className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer ${
                            isLocked(draft) ? "opacity-75" : ""
                          }`}
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {formatDate(draft.entry_date)}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                            {draft.description}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <div className="flex items-center gap-2">
                              {getStatusBadge(draft.status)}
                              {isLocked(draft) && (
                                <span className="text-gray-400 dark:text-gray-500" title="Locked">
                                  🔒
                                </span>
                              )}
                              {isImbalanced(draft) && (
                                <span className="text-red-500" title="Imbalanced">
                                  ⚠️
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 dark:text-white">
                            ₵{draft.total_debit.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 dark:text-white">
                            ₵{draft.total_credit.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {getUserDisplayName(draft.created_by_user)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {formatDateTime(draft.updated_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-between">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalCount)} of {totalCount} drafts
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600"
                    >
                      Previous
                    </button>
                    <span className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
