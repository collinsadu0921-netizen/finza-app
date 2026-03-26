"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import EmptyState from "@/components/ui/EmptyState"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getActiveFirmId } from "@/lib/accounting/firm/session"
import AccountingBreadcrumbs from "@/components/AccountingBreadcrumbs"
import { useToast } from "@/components/ui/ToastProvider"
import {
  useAccountingBusiness,
  CLIENT_NOT_SELECTED_DESCRIPTION,
} from "@/lib/accounting/useAccountingBusiness"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { formatCurrencySafe } from "@/lib/currency/formatCurrency"

type OpeningBalanceLine = {
  account_id: string
  debit: number
  credit: number
  memo: string | null
}

type OpeningBalanceImport = {
  id: string
  status: "draft" | "approved" | "posted"
  source_type: "manual" | "csv" | "excel"
  total_debit: number
  total_credit: number
  lines: OpeningBalanceLine[]
  created_by: string | null
  approved_by: string | null
  posted_by: string | null
  created_at: string
  approved_at: string | null
  posted_at: string | null
  journal_entry_id: string | null
  period_id: string
  accounting_periods: {
    period_start: string
    period_end: string
    status: string
  } | null
  created_by_name: string | null
  approved_by_name: string | null
  posted_by_name: string | null
}

type Account = {
  id: string
  code: string
  name: string
  type: string
}

export default function OpeningBalanceImportReviewPage() {
  const toast = useToast()
  const router = useRouter()
  const params = useParams()
  const importId = params.id as string
  const { businessId: clientBusinessId, loading: contextLoading, error: contextError } = useAccountingBusiness()

  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState("")
  const [firmId, setFirmId] = useState<string | null>(null)
  const [importData, setImportData] = useState<OpeningBalanceImport | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Record<string, Account>>({})
  const [showPostModal, setShowPostModal] = useState(false)
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    setFirmId(getActiveFirmId())
  }, [])

  useEffect(() => {
    if (importId && clientBusinessId) {
      loadImport()
      loadAccounts()
    }
  }, [importId, clientBusinessId])

  useEffect(() => {
    if (firmId) {
      loadUserRole()
    }
  }, [firmId])

  const loadUserRole = async () => {
    if (!firmId) return

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data: firmUser } = await supabase
        .from("accounting_firm_users")
        .select("role")
        .eq("firm_id", firmId)
        .eq("user_id", user.id)
        .maybeSingle()

      setUserRole(firmUser?.role || null)
    } catch (err) {
      console.error("Error loading user role:", err)
    }
  }

  const loadAccounts = async () => {
    if (!clientBusinessId) return

    try {
      const response = await fetch(`/api/accounting/coa?business_id=${clientBusinessId}`)
      if (!response.ok) {
        throw new Error("Failed to load accounts")
      }

      const data = await response.json()
      const accountsMap: Record<string, Account> = {}
      ;(data.accounts || []).forEach((account: Account) => {
        accountsMap[account.id] = account
      })
      setAccounts(accountsMap)
    } catch (err) {
      console.error("Error loading accounts:", err)
    }
  }

  const loadImport = async () => {
    if (!importId || !clientBusinessId) return

    try {
      setLoading(true)
      const response = await fetch(
        `/api/accounting/opening-balances/${importId}?business_id=${clientBusinessId}`
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to load opening balance import")
      }

      const data = await response.json()
      setImportData(data.import)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load opening balance import")
      setLoading(false)
    }
  }

  const handleApprove = async () => {
    if (!importId) return

    try {
      setProcessing(true)
      setError("")

      const response = await fetch(
        `/api/accounting/opening-balances/${importId}/approve?business_id=${clientBusinessId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error || "Failed to approve opening balance import")
      }

      // Reload import data
      await loadImport()
    } catch (err: any) {
      setError(err.message || "Failed to approve opening balance import")
    } finally {
      setProcessing(false)
    }
  }

  const handlePost = async () => {
    if (!importId) return

    try {
      setPosting(true)
      setError("")

      const response = await fetch(
        `/api/accounting/opening-balances/${importId}/post?business_id=${clientBusinessId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error || "Failed to post opening balance import")
      }

      // Reload import data
      await loadImport()
      setShowPostModal(false)

      // Show success message
      if (data.already_posted) {
        toast.showToast("Opening balance import was already posted.", "info")
      } else {
        toast.showToast(`Opening balance import posted successfully. Journal Entry ID: ${data.journal_entry_id}`, "success")
      }
    } catch (err: any) {
      setError(err.message || "Failed to post opening balance import")
    } finally {
      setPosting(false)
    }
  }

  const getAccountName = (accountId: string): string => {
    const account = accounts[accountId]
    return account ? `${account.code} - ${account.name}` : accountId
  }

  const isPartner = userRole === "partner"
  const periodLocked = importData?.accounting_periods?.status === "locked"

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

  if (contextError) {
    return (
      <ProtectedLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <EmptyState title="Client not selected" description={CLIENT_NOT_SELECTED_DESCRIPTION} />
        </div>
      </ProtectedLayout>
    )
  }

  if (loading) {
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

  if (!importData) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded">
              {error || "Opening balance import not found"}
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  const isBalanced = Math.abs(importData.total_debit - importData.total_credit) < 0.01

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <AccountingBreadcrumbs />

          <div className="mb-8">
            <button
              onClick={() =>
                router.push(
                  clientBusinessId
                    ? `/accounting/opening-balances-imports?business_id=${clientBusinessId}`
                    : "/accounting/opening-balances-imports"
                )
              }
              className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
            >
              ← Back to Opening Balance Imports
            </button>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              Review Opening Balance Import
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              Period:{" "}
              {importData.accounting_periods
                ? new Date(importData.accounting_periods.period_start).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                  })
                : "—"}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {periodLocked && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              <strong>Period is locked.</strong> Cannot approve or post opening balance import for locked period.
            </div>
          )}

          {!isBalanced && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              <strong>Imbalanced totals.</strong> Debits and credits must balance before approval.
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Opening Balance Import
                </h2>
                <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                  <span>Status: {importData.status}</span>
                  <span>•</span>
                  <span>Source: {importData.source_type}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Debit</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {formatCurrencySafe(importData.total_debit)}
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Credit</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {formatCurrencySafe(importData.total_credit)}
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Line Items</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Account
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Debit
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Credit
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Memo
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {importData.lines.map((line, index) => (
                      <tr key={index}>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {getAccountName(line.account_id)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                          {line.debit > 0 ? formatCurrencySafe(line.debit) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                          {line.credit > 0 ? formatCurrencySafe(line.credit) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {line.memo || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Created by:</span>{" "}
                  <span className="font-medium text-gray-900 dark:text-white">
                    {importData.created_by_name || "Unknown"}
                  </span>
                  <br />
                  <span className="text-gray-500 dark:text-gray-500 text-xs">
                    {new Date(importData.created_at).toLocaleString()}
                  </span>
                </div>
                {importData.approved_by && (
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Approved by:</span>{" "}
                    <span className="font-medium text-gray-900 dark:text-white">
                      {importData.approved_by_name || "Unknown"}
                    </span>
                    <br />
                    <span className="text-gray-500 dark:text-gray-500 text-xs">
                      {importData.approved_at
                        ? new Date(importData.approved_at).toLocaleString()
                        : ""}
                    </span>
                  </div>
                )}
                {importData.posted_by && (
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Posted by:</span>{" "}
                    <span className="font-medium text-gray-900 dark:text-white">
                      {importData.posted_by_name || "Unknown"}
                    </span>
                    <br />
                    <span className="text-gray-500 dark:text-gray-500 text-xs">
                      {importData.posted_at ? new Date(importData.posted_at).toLocaleString() : ""}
                    </span>
                  </div>
                )}
                {importData.journal_entry_id && (
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Journal Entry ID:</span>{" "}
                    <span className="font-medium text-gray-900 dark:text-white">
                      {importData.journal_entry_id}
                    </span>
                    <br />
                    <a
                      href={
                        clientBusinessId
                          ? `${buildAccountingRoute("/accounting/ledger", clientBusinessId)}&journal_entry_id=${importData.journal_entry_id}`
                          : "/accounting"
                      }
                      className="text-blue-600 dark:text-blue-400 hover:underline text-xs"
                    >
                      View Journal Entry
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() =>
                router.push(
                  clientBusinessId
                    ? `/accounting/opening-balances-imports?business_id=${clientBusinessId}`
                    : "/accounting/opening-balances-imports"
                )
              }
              className="px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Back
            </button>
            {importData.status === "draft" && isPartner && !periodLocked && isBalanced && (
              <button
                onClick={handleApprove}
                disabled={processing}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 text-white font-medium rounded-lg shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processing ? "Approving..." : "Approve"}
              </button>
            )}
            {importData.status === "approved" && isPartner && !periodLocked && (
              <button
                onClick={() => setShowPostModal(true)}
                disabled={processing}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white font-medium rounded-lg shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Post to Ledger
              </button>
            )}
            {!isPartner && (
              <div className="px-6 py-3 text-sm text-gray-600 dark:text-gray-400">
                Partner role required for approval and posting
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Posting Confirmation Modal */}
      {showPostModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Post Opening Balance to Ledger
            </h3>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded mb-4">
              <strong>Warning:</strong> This posts the opening balance to the ledger. This can only be done once.
            </div>
            <div className="space-y-3 mb-6">
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-400">Period:</span>{" "}
                <span className="font-medium text-gray-900 dark:text-white">
                  {importData.accounting_periods
                    ? new Date(importData.accounting_periods.period_start).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                      })
                    : "—"}
                </span>
              </div>
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-400">Total Debit:</span>{" "}
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatCurrencySafe(importData.total_debit)}
                </span>
              </div>
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-400">Total Credit:</span>{" "}
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatCurrencySafe(importData.total_credit)}
                </span>
              </div>
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-400">Line Count:</span>{" "}
                <span className="font-medium text-gray-900 dark:text-white">
                  {importData.lines.length}
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowPostModal(false)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePost}
                disabled={posting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {posting ? "Posting..." : "Post Opening Balance"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ProtectedLayout>
  )
}
