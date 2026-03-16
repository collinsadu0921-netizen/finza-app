"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import EmptyState from "@/components/ui/EmptyState"
import { useRouter, useParams } from "next/navigation"
import {
  useAccountingBusiness,
  CLIENT_NOT_SELECTED_DESCRIPTION,
} from "@/lib/accounting/useAccountingBusiness"

type JournalLine = {
  id: string
  account_id: string | null
  debit: number
  credit: number
  memo?: string
  account?: {
    id: string
    code: string
    name: string
    type: string
  }
}

type Draft = {
  id: string
  status: "draft" | "submitted" | "approved" | "rejected"
  entry_date: string
  description: string
  lines: JournalLine[]
  total_debit: number
  total_credit: number
  created_by: string
  created_at: string
  submitted_by?: string
  submitted_at?: string
  approved_by?: string
  approved_at?: string
  rejected_by?: string
  rejected_at?: string
  rejection_reason?: string
  created_by_user?: {
    id: string
    email: string
    raw_user_meta_data?: {
      full_name?: string
    }
  }
  submitted_by_user?: {
    id: string
    email: string
    raw_user_meta_data?: {
      full_name?: string
    }
  }
  approved_by_user?: {
    id: string
    email: string
    raw_user_meta_data?: {
      full_name?: string
    }
  }
  rejected_by_user?: {
    id: string
    email: string
    raw_user_meta_data?: {
      full_name?: string
    }
  }
  period?: {
    id: string
    period_start: string
    period_end: string
    status: string
  }
}

export default function ReviewDraftPage() {
  const router = useRouter()
  const params = useParams()
  const draftId = params.id as string
  const { businessId: clientBusinessId, loading: contextLoading, error: contextError } = useAccountingBusiness()

  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (draftId) {
      loadDraft()
    }
  }, [draftId])

  const loadDraft = async () => {
    if (!draftId) return
    try {
      setLoading(true)
      const url =
        clientBusinessId
          ? `/api/accounting/journals/drafts/${draftId}?business_id=${clientBusinessId}`
          : `/api/accounting/journals/drafts/${draftId}`
      const response = await fetch(url)
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || "Failed to load draft")
      }

      const data = await response.json()
      setDraft(data.draft)
    } catch (err: any) {
      setError(err.message || "Failed to load draft")
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString("en-GH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const formatDateTime = (dateString: string): string => {
    return new Date(dateString).toLocaleString("en-GH", {
      year: "numeric",
      month: "short",
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

  const getUserDisplayName = (user?: {
    id: string
    email: string
    raw_user_meta_data?: {
      full_name?: string
    }
  }): string => {
    if (!user) return "Unknown"
    if (user.raw_user_meta_data?.full_name) {
      return user.raw_user_meta_data.full_name
    }
    if (user.email) {
      return user.email
    }
    return "Unknown"
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
      submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    }
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${styles[status] || styles.draft}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  const isImbalanced = (): boolean => {
    if (!draft) return false
    return Math.abs(draft.total_debit - draft.total_credit) >= 0.01
  }

  const isLocked = (): boolean => {
    if (!draft) return false
    return draft.status === "approved" || draft.status === "rejected"
  }

  if (contextLoading || loading) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Loading draft...</p>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  if (contextError) {
    return (
      <ProtectedLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <EmptyState title="Client not selected" description={CLIENT_NOT_SELECTED_DESCRIPTION} />
        </div>
      </ProtectedLayout>
    )
  }

  if (!draft) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded">
              {error || "Draft not found"}
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
          <div className="flex justify-between items-center mb-8">
            <div>
              <button
                onClick={() => router.push(clientBusinessId ? `/accounting/journals?business_id=${clientBusinessId}` : "/accounting/journals")}
                className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
              >
                ← Back to Journals
              </button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Manual Journal Draft Review
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Read-only view of journal entry draft
              </p>
            </div>
            {draft.status === "draft" && (
              <button
                onClick={() => router.push(clientBusinessId ? `/accounting/journals/drafts/${draftId}?business_id=${clientBusinessId}` : `/accounting/journals/drafts/${draftId}`)}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white font-medium rounded-lg shadow-lg transition-colors"
              >
                Edit Draft
              </button>
            )}
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Header Info */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex items-center gap-4 mb-4">
              {getStatusBadge(draft.status)}
              {isImbalanced() && (
                <span className="text-yellow-600 dark:text-yellow-400" title="Imbalanced entry">
                  ⚠️ Imbalance Warning
                </span>
              )}
              {isLocked() && (
                <span className="text-gray-600 dark:text-gray-400" title="Locked">
                  🔒 Locked
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Period
                </label>
                <p className="text-gray-900 dark:text-white">
                  {draft.period ? `${formatPeriod(draft.period.period_start)} (${draft.period.status})` : "—"}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Entry Date
                </label>
                <p className="text-gray-900 dark:text-white">{formatDate(draft.entry_date)}</p>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Description
            </label>
            <p className="text-gray-900 dark:text-white">{draft.description}</p>
          </div>

          {/* Journal Lines Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Journal Lines</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Account</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Debit</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Credit</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Memo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {draft.lines.map((line, index) => (
                    <tr key={line.id || index} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                        {line.account
                          ? `${line.account.code} - ${line.account.name} (${line.account.type})`
                          : "Account not found"}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                        {line.debit > 0
                          ? line.debit.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                        {line.credit > 0
                          ? line.credit.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {line.memo || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 dark:bg-gray-700 font-semibold">
                  <tr>
                    <td className="px-4 py-3 text-right" colSpan={1}>Totals:</td>
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                      {draft.total_debit.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                      {draft.total_credit.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-3" colSpan={1}>
                      {!isImbalanced() ? (
                        <span className="text-green-600 dark:text-green-400">✓ Balanced</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400">
                          Imbalance: {Math.abs(draft.total_debit - draft.total_credit).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Metadata */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Metadata</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Created By
                </label>
                <p className="text-gray-900 dark:text-white">
                  {getUserDisplayName(draft.created_by_user)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {formatDateTime(draft.created_at)}
                </p>
              </div>
              {draft.submitted_by_user && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Submitted By
                  </label>
                  <p className="text-gray-900 dark:text-white">
                    {getUserDisplayName(draft.submitted_by_user)}
                  </p>
                  {draft.submitted_at && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {formatDateTime(draft.submitted_at)}
                    </p>
                  )}
                </div>
              )}
              {draft.approved_by_user && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Approved By
                  </label>
                  <p className="text-gray-900 dark:text-white">
                    {getUserDisplayName(draft.approved_by_user)}
                  </p>
                  {draft.approved_at && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {formatDateTime(draft.approved_at)}
                    </p>
                  )}
                </div>
              )}
              {draft.rejected_by_user && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Rejected By
                  </label>
                  <p className="text-gray-900 dark:text-white">
                    {getUserDisplayName(draft.rejected_by_user)}
                  </p>
                  {draft.rejected_at && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {formatDateTime(draft.rejected_at)}
                    </p>
                  )}
                  {draft.rejection_reason && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                      Reason: {draft.rejection_reason}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Back Button */}
          <div className="flex justify-end">
            <button
              onClick={() => router.push(clientBusinessId ? `/accounting/journals?business_id=${clientBusinessId}` : "/accounting/journals")}
              className="px-6 py-3 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium transition-all"
            >
              Back to Journals
            </button>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
