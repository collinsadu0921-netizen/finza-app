"use client"

import { useState, useEffect } from "react"
import EmptyState from "@/components/ui/EmptyState"
import Modal from "@/components/ui/Modal"
import { useRouter } from "next/navigation"
import {
  useAccountingReadiness,
  ACCOUNTING_NOT_INITIALIZED_TITLE,
  ACCOUNTING_NOT_INITIALIZED_DESCRIPTION,
  ACCOUNTING_NOT_INITIALIZED_ACCOUNTANT_SECONDARY,
} from "@/lib/accounting/useAccountingReadiness"
import ReadinessBanner from "@/components/accounting/ReadinessBanner"
import { buildServiceRoute } from "@/lib/service/routes"
import type { ScreenProps } from "./types"

const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const

type Account = {
  id: string
  code: string
  name: string
  type: "asset" | "liability" | "equity" | "income" | "expense"
  description: string | null
  is_system: boolean
}

export default function ChartOfAccountsScreen({ mode, businessId }: ScreenProps) {
  const router = useRouter()
  const { ready, authority_source, loading: readinessLoading, refetch: refetchReadiness } = useAccountingReadiness(businessId)
  const noContext = !businessId
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [error, setError] = useState("")
  const [filterType, setFilterType] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createName, setCreateName] = useState("")
  const [createCode, setCreateCode] = useState("")
  const [createType, setCreateType] = useState<Account["type"]>("asset")
  const [createDescription, setCreateDescription] = useState("")
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [createError, setCreateError] = useState("")

  useEffect(() => {
    if (!businessId) setLoading(false)
  }, [businessId])

  useEffect(() => {
    if (businessId) {
      loadAccounts()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  const loadAccounts = async () => {
    if (!businessId) return
    try {
      setLoading(true)
      const response = await fetch(`/api/accounting/coa?business_id=${businessId}`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load Chart of Accounts")
      }

      const data = await response.json()
      setAccounts(data.accounts || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load Chart of Accounts")
      setLoading(false)
    }
  }

  const openCreateModal = () => {
    setCreateName("")
    setCreateCode("")
    setCreateType("asset")
    setCreateDescription("")
    setCreateError("")
    setShowCreateModal(true)
  }

  const closeCreateModal = () => {
    if (!createSubmitting) setShowCreateModal(false)
  }

  const handleCreateAccount = async () => {
    setCreateError("")
    if (!createName.trim() || !createCode.trim()) {
      setCreateError("Name and code are required.")
      return
    }
    setCreateSubmitting(true)
    try {
      const response = await fetch("/api/accounts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          code: createCode.trim(),
          type: createType,
          description: createDescription.trim() || undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Failed to create account")
      }
      setShowCreateModal(false)
      await loadAccounts()
    } catch (err: any) {
      setCreateError(err.message || "Failed to create account")
    } finally {
      setCreateSubmitting(false)
    }
  }

  const getTypeBadge = (type: string) => {
    const styles = {
      asset: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400 border border-blue-300 dark:border-blue-700",
      liability: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400 border border-red-300 dark:border-red-700",
      equity: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400 border border-green-300 dark:border-green-700",
      income: "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400 border border-purple-300 dark:border-purple-700",
      expense: "bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400 border border-orange-300 dark:border-orange-700",
    }
    const labels = {
      asset: "Asset",
      liability: "Liability",
      equity: "Equity",
      income: "Income",
      expense: "Expense",
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold ${styles[type as keyof typeof styles] || styles.asset}`}>
        {labels[type as keyof typeof labels] || type}
      </span>
    )
  }

  const filteredAccounts = accounts.filter((account) => {
    if (filterType && account.type !== filterType) return false
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      return (
        account.code.toLowerCase().includes(search) ||
        account.name.toLowerCase().includes(search) ||
        (account.description && account.description.toLowerCase().includes(search))
      )
    }
    return true
  })

  const typeCounts = {
    asset: accounts.filter((a) => a.type === "asset").length,
    liability: accounts.filter((a) => a.type === "liability").length,
    equity: accounts.filter((a) => a.type === "equity").length,
    income: accounts.filter((a) => a.type === "income").length,
    expense: accounts.filter((a) => a.type === "expense").length,
  }

  const groupedByType = {
    asset: accounts.filter((a) => a.type === "asset"),
    liability: accounts.filter((a) => a.type === "liability"),
    equity: accounts.filter((a) => a.type === "equity"),
    income: accounts.filter((a) => a.type === "income"),
    expense: accounts.filter((a) => a.type === "expense"),
  }

  const backUrl = mode === "service" ? buildServiceRoute("/service/accounting", businessId) : (businessId ? `/accounting?business_id=${businessId}` : "/accounting")

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
            description="Select a client from the Accounting workspace or open a business in the Service workspace to view the Chart of Accounts."
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
    
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <ReadinessBanner
            ready={ready}
            authoritySource={authority_source}
            businessId={businessId}
            onInitSuccess={refetchReadiness}
          />
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-8">
            <div>
              <button
                onClick={() => router.push(backUrl)}
                className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
              >
                ← Back to Accounting
              </button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Chart of Accounts
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                View and add accounts. Only asset, liability, and equity (non-system) accounts are eligible for opening balances.
              </p>
            </div>
            <button
              type="button"
              onClick={openCreateModal}
              className="shrink-0 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors"
            >
              Add account
            </button>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Info Banner */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 text-blue-700 dark:text-blue-400 px-4 py-3 rounded mb-6">
            <p className="text-sm font-medium">
              You can add custom accounts with the button above. Only asset, liability, and equity accounts (non-system) are eligible for opening balances.
            </p>
          </div>

          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 mb-6">
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Search */}
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search by code, name, or description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              {/* Type Filter */}
              <div>
                <select
                  value={filterType || ""}
                  onChange={(e) => setFilterType(e.target.value || null)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">All Types</option>
                  <option value="asset">Asset ({typeCounts.asset})</option>
                  <option value="liability">Liability ({typeCounts.liability})</option>
                  <option value="equity">Equity ({typeCounts.equity})</option>
                  <option value="income">Income ({typeCounts.income})</option>
                  <option value="expense">Expense ({typeCounts.expense})</option>
                </select>
              </div>
            </div>
          </div>

          {/* Accounts Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      Code
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      Description
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      System
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                      Eligibility
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                        {searchTerm || filterType ? "No accounts found matching filters" : "No accounts found"}
                      </td>
                    </tr>
                  ) : (
                    filteredAccounts.map((account) => {
                      const isEligible =
                        ["asset", "liability", "equity"].includes(account.type) && !account.is_system
                      return (
                        <tr
                          key={account.id}
                          className={`transition-colors ${
                            isEligible
                              ? "hover:bg-green-50 dark:hover:bg-green-900/10"
                              : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                          }`}
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                            {account.code}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                            {account.name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {getTypeBadge(account.type)}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                            {account.description || "—"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {account.is_system ? (
                              <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 rounded">
                                System
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {isEligible ? (
                              <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400 rounded">
                                ✅ Eligible
                              </span>
                            ) : (
                              <span
                                className="px-2 py-1 text-xs font-medium bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400 rounded border border-amber-200 dark:border-amber-800"
                                title="Income, expense, and system accounts cannot receive opening balances."
                              >
                                Not eligible for opening balances
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Summary Footer */}
            <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                <strong>Total:</strong> {filteredAccounts.length} of {accounts.length} accounts
                {filteredAccounts.length !== accounts.length && ` (filtered)`}
                {" • "}
                <strong>Eligible for opening balances:</strong>{" "}
                {filteredAccounts.filter(
                  (a) => ["asset", "liability", "equity"].includes(a.type) && !a.is_system
                ).length}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Income, expense, and system accounts cannot receive opening balances.
              </p>
            </div>
          </div>

          <Modal
            isOpen={showCreateModal}
            onClose={closeCreateModal}
            title="Add account"
            size="md"
            closeOnOverlayClick={!createSubmitting}
            footer={
              <>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={createSubmitting}
                  className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateAccount}
                  disabled={createSubmitting}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50"
                >
                  {createSubmitting ? "Creating…" : "Create account"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {createError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                  {createError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Code</label>
                <input
                  type="text"
                  value={createCode}
                  onChange={(e) => setCreateCode(e.target.value)}
                  placeholder="e.g. 1200"
                  disabled={createSubmitting}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Petty Cash"
                  disabled={createSubmitting}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
                <select
                  value={createType}
                  onChange={(e) => setCreateType(e.target.value as Account["type"])}
                  disabled={createSubmitting}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white disabled:opacity-60"
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="Optional description"
                  disabled={createSubmitting}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white disabled:opacity-60"
                />
              </div>
            </div>
          </Modal>
        </div>
      </div>
    
  )
}

