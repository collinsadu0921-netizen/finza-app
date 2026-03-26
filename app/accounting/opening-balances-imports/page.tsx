"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import EmptyState from "@/components/ui/EmptyState"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getActiveFirmId } from "@/lib/accounting/firm/session"
import AccountingBreadcrumbs from "@/components/AccountingBreadcrumbs"
import {
  useAccountingBusiness,
  CLIENT_NOT_SELECTED_DESCRIPTION,
} from "@/lib/accounting/useAccountingBusiness"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { formatCurrencySafe } from "@/lib/currency/formatCurrency"

type OpeningBalanceImport = {
  id: string
  status: "draft" | "approved" | "posted"
  source_type: "manual" | "csv" | "excel"
  total_debit: number
  total_credit: number
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

export default function OpeningBalanceImportsPage() {
  const router = useRouter()
  const { businessId: clientBusinessId, loading: contextLoading, error: contextError } = useAccountingBusiness()
  const [loading, setLoading] = useState(true)
  const [importData, setImportData] = useState<OpeningBalanceImport | null>(null)
  const [error, setError] = useState("")
  const [firmId, setFirmId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)

  useEffect(() => {
    setFirmId(getActiveFirmId())
  }, [])

  useEffect(() => {
    if (clientBusinessId) {
      loadImport()
    }
  }, [clientBusinessId])

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

  const loadImport = async () => {
    if (!clientBusinessId) return

    try {
      setLoading(true)
      const response = await fetch(
        `/api/accounting/opening-balances?business_id=${clientBusinessId}`
      )

      if (!response.ok) {
        if (response.status === 404) {
          // No import exists - this is fine
          setImportData(null)
          setLoading(false)
          return
        }
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to load opening balance import")
      }

      const data = await response.json()
      setImportData(data.import || null)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load opening balance import")
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const badges = {
      draft: "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200",
      approved: "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400",
      posted: "bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-400",
    }
    return badges[status as keyof typeof badges] || badges.draft
  }

  const formatPeriod = (periodStart: string): string => {
    const date = new Date(periodStart)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    return `${year}-${month}`
  }

  const appendBusinessId = (route: string) => {
    if (!clientBusinessId) return route
    return route.includes("?") ? `${route}&business_id=${clientBusinessId}` : `${route}?business_id=${clientBusinessId}`
  }

  const getPrimaryAction = () => {
    if (!importData) {
      return {
        label: "Create Opening Balance",
        route: "/accounting/opening-balances-imports/new",
        enabled: true,
      }
    }

    switch (importData.status) {
      case "draft":
        return {
          label: "Continue Draft",
          route: `/accounting/opening-balances-imports/${importData.id}/edit`,
          enabled: true,
        }
      case "approved":
        return {
          label: "Review & Post",
          route: `/accounting/opening-balances-imports/${importData.id}`,
          enabled: true,
        }
      case "posted":
        return {
          label: "View Journal Entry",
          route: importData.journal_entry_id && clientBusinessId
            ? `${buildAccountingRoute("/accounting/ledger", clientBusinessId)}&journal_entry_id=${importData.journal_entry_id}`
            : clientBusinessId
              ? buildAccountingRoute("/accounting/ledger", clientBusinessId)
              : "/accounting",
          enabled: true,
        }
      default:
        return { label: "View", route: `/accounting/opening-balances-imports/${importData.id}`, enabled: true }
    }
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

  const primaryAction = getPrimaryAction()

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <AccountingBreadcrumbs />

          <div className="flex justify-between items-center mb-8">
            <div>
              <button
                onClick={() => router.push(clientBusinessId ? `/accounting?business_id=${clientBusinessId}` : "/accounting")}
                className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
              >
                ← Back to Accounting
              </button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Opening Balance Imports
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Create and manage opening balance imports for external clients
              </p>
            </div>
            {primaryAction.enabled && (
              <button
                onClick={() => router.push(appendBusinessId(primaryAction.route))}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white font-medium rounded-lg shadow-lg transition-colors"
              >
                {primaryAction.label}
              </button>
            )}
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {importData && importData.status === "posted" && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded mb-6">
              <strong>Opening balance already posted.</strong> Only one opening balance can be posted per business.
            </div>
          )}

          {!importData ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="max-w-md mx-auto">
                <div className="text-6xl mb-4">💰</div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  No Opening Balance Import
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Create an opening balance import to establish the initial ledger position for this client.
                </p>
                <button
                  onClick={() => router.push(appendBusinessId("/accounting/opening-balances-imports/new"))}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white font-medium rounded-lg shadow-lg transition-colors"
                >
                  Create Opening Balance
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="p-6">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                      Opening Balance Import
                    </h2>
                    <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                      <span>
                        Period:{" "}
                        {importData.accounting_periods
                          ? formatPeriod(importData.accounting_periods.period_start)
                          : "—"}
                      </span>
                      <span>•</span>
                      <span>Source: {importData.source_type}</span>
                    </div>
                  </div>
                  <span
                    className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${getStatusBadge(
                      importData.status
                    )}`}
                  >
                    {importData.status.charAt(0).toUpperCase() + importData.status.slice(1)}
                  </span>
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
                  </div>
                </div>

                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => router.push(appendBusinessId(primaryAction.route))}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white font-medium rounded-lg transition-colors"
                  >
                    {primaryAction.label}
                  </button>
                  {importData.status !== "draft" && (
                    <button
                      onClick={() => router.push(appendBusinessId(`/accounting/opening-balances-imports/${importData.id}`))}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      View Details
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
