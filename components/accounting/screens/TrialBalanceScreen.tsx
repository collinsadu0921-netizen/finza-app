"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
import {
  ACCOUNTING_NOT_INITIALIZED_TITLE,
  ACCOUNTING_NOT_INITIALIZED_DESCRIPTION,
  ACCOUNTING_NOT_INITIALIZED_ACCOUNTANT_SECONDARY,
} from "@/lib/accounting/useAccountingReadiness"
import ReadinessBanner from "@/components/accounting/ReadinessBanner"
import { formatCurrencySafe } from "@/lib/currency/formatCurrency"
import { buildServiceRoute } from "@/lib/service/routes"
import EmptyState from "@/components/ui/EmptyState"
import type { ScreenProps } from "./types"
import { downloadFileFromApi } from "@/lib/download/downloadFileFromApi"

type AccountingPeriod = {
  id: string
  business_id: string
  period_start: string
  period_end: string
  status: "open" | "soft_closed" | "locked"
}

type AccountBalance = {
  account_id: string
  account_code: string
  account_name: string
  account_type: string
  debit_total?: number | null
  credit_total?: number | null
  ending_balance?: number | null
  closing_balance?: number | null
}

export default function TrialBalanceScreen({ mode, businessId }: ScreenProps) {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const noContext = !businessId
  const routeContextOk = !!businessId
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [selectedPeriodStart, setSelectedPeriodStart] = useState<string | null>(null)
  const [useDateRange, setUseDateRange] = useState(false)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [accounts, setAccounts] = useState<AccountBalance[]>([])
  const [byType, setByType] = useState<Record<string, AccountBalance[]>>({})
  const [totals, setTotals] = useState<any>(null)
  const [isBalanced, setIsBalanced] = useState(false)
  const [imbalance, setImbalance] = useState(0)
  const [error, setError] = useState("")
  const [readiness, setReadiness] = useState<{ ready: boolean; authority_source: string | null } | null>(null)
  const [readinessLoading, setReadinessLoading] = useState(true)

  useEffect(() => {
    if (!businessId) setLoading(false)
  }, [businessId])

  useEffect(() => {
    if (!businessId) return
    loadPeriods()
    // No period/date selected yet — show period selector, not loading spinner
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  useEffect(() => {
    if (!businessId) {
      setReadiness(null)
      setReadinessLoading(false)
      return
    }
    setReadinessLoading(true)
    fetch(`/api/accounting/readiness?business_id=${encodeURIComponent(businessId)}`)
      .then((res) => res.json())
      .then((data) => {
        setReadiness({
          ready: data.ready === true,
          authority_source: data.authority_source ?? null,
        })
      })
      .catch(() => setReadiness({ ready: false, authority_source: null }))
      .finally(() => setReadinessLoading(false))
  }, [businessId])

  useEffect(() => {
    if (!businessId) return
    if (selectedPeriodStart || (useDateRange && startDate && endDate)) {
      loadTrialBalance()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, selectedPeriodStart, useDateRange, startDate, endDate])

  const loadPeriods = async () => {
    if (!businessId) return
    try {
      const response = await fetch(`/api/accounting/periods?business_id=${businessId}`)

      if (!response.ok) {
        throw new Error("Failed to load accounting periods")
      }

      const data = await response.json()
      // Reports can read open, soft_closed, and locked periods
      setPeriods(data.periods || [])
    } catch (err: any) {
      console.error("Error loading periods:", err)
      setPeriods([])
    }
  }

  const loadTrialBalance = async () => {
    if (!businessId) return
    if (!selectedPeriodStart && !(useDateRange && startDate && endDate)) return

    try {
      setLoading(true)
      setError("")

      let url = `/api/accounting/reports/trial-balance?business_id=${businessId}`
      if (selectedPeriodStart && !useDateRange) {
        url += `&period_start=${selectedPeriodStart}`
      } else if (useDateRange && startDate && endDate) {
        url += `&start_date=${startDate}&end_date=${endDate}`
      }

      const response = await fetch(url)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load trial balance")
      }

      const data = await response.json()
      setAccounts(data.accounts || [])
      setByType(data.byType || {})
      setTotals(data.totals)
      setIsBalanced(data.isBalanced || false)
      setImbalance(data.imbalance || 0)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load trial balance")
      setLoading(false)
    }
  }

  const formatPeriod = (periodStart: string): string => {
    const date = new Date(periodStart)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    return `${year}-${month}`
  }

  const getAccountTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      asset: "Asset",
      liability: "Liability",
      equity: "Equity",
      income: "Income",
      expense: "Expense",
    }
    return labels[type] || type
  }

  const handleExportCSV = async () => {
    if (!businessId) return
    if (!selectedPeriodStart && !(useDateRange && startDate && endDate)) {
      toast.showToast("Please select a period or date range first", "warning")
      return
    }

    let url = `/api/accounting/reports/trial-balance/export/csv?business_id=${businessId}`
    if (selectedPeriodStart && !useDateRange) {
      url += `&period_start=${selectedPeriodStart}`
    } else if (useDateRange && startDate && endDate) {
      url += `&start_date=${startDate}&end_date=${endDate}`
    }

    try {
      await downloadFileFromApi(url, { fallbackFilename: "trial-balance.csv" })
    } catch (err: unknown) {
      toast.showToast(err instanceof Error ? err.message : "Could not download CSV", "error")
    }
  }

  const handleExportPDF = async () => {
    if (!businessId) return
    if (!selectedPeriodStart && !(useDateRange && startDate && endDate)) {
      toast.showToast("Please select a period or date range first", "warning")
      return
    }

    let url = `/api/accounting/reports/trial-balance/export/pdf?business_id=${businessId}`
    if (selectedPeriodStart && !useDateRange) {
      url += `&period_start=${selectedPeriodStart}`
    } else if (useDateRange && startDate && endDate) {
      url += `&start_date=${startDate}&end_date=${endDate}`
    }

    try {
      await downloadFileFromApi(url, {
        fallbackFilename: "trial-balance.pdf",
        expectedMimePrefix: "application/pdf",
      })
    } catch (err: unknown) {
      toast.showToast(err instanceof Error ? err.message : "Could not download PDF", "error")
    }
  }

  const backUrl = mode === "service" ? buildServiceRoute("/service/accounting", businessId) : (businessId ? `/accounting?business_id=${businessId}` : "/accounting")

  if ((loading && !accounts.length) || (businessId && readinessLoading)) {
    return (
      
        <div className="p-6">
          <p>Loading...</p>
        </div>
      
    )
  }

  if (!routeContextOk || noContext) {
    return (
      
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-6 text-amber-800 dark:text-amber-200">
              <p className="font-medium">Select a client or ensure you have an active business.</p>
              <p className="text-sm mt-1">No business context is available.</p>
            </div>
          </div>
        </div>
      
    )
  }

  if (!readinessLoading && readiness && readiness.authority_source === "accountant" && !readiness.ready) {
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
            ready={readiness?.ready ?? null}
            authoritySource={(readiness?.authority_source ?? null) as "accountant" | "owner" | "employee" | "report_viewer" | null}
            businessId={businessId}
            onInitSuccess={() => window.location.reload()}
          />
          <div className="flex justify-between items-center mb-8 export-hide print-hide">
            <div>
              <button
                onClick={() => router.push(backUrl)}
                className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
              >
                ← Back to Accounting
              </button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Trial Balance
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                View account balances and verify ledger is balanced. Ledger-only report.
              </p>
            </div>
            {accounts.length > 0 && (
              <div className="flex gap-3">
                <button
                  onClick={handleExportCSV}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export CSV
                </button>
                <button
                  onClick={handleExportPDF}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 font-medium flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Export PDF
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Period/Date Range Selector - hidden in print/export */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6 export-hide print-hide">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center mb-2">
                  <input
                    type="radio"
                    checked={!useDateRange}
                    onChange={() => {
                      setUseDateRange(false)
                      setStartDate("")
                      setEndDate("")
                    }}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Select Accounting Period
                  </span>
                </label>
                <select
                  value={selectedPeriodStart || ""}
                  onChange={(e) => {
                    setSelectedPeriodStart(e.target.value || null)
                    setError("")
                  }}
                  disabled={useDateRange}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                >
                  <option value="">-- Select Period --</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.period_start}>
                      {formatPeriod(period.period_start)} ({period.status})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center mb-2">
                  <input
                    type="radio"
                    checked={useDateRange}
                    onChange={() => {
                      setUseDateRange(true)
                      setSelectedPeriodStart(null)
                    }}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Custom Date Range
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value)
                      setError("")
                    }}
                    disabled={!useDateRange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                  />
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value)
                      setError("")
                    }}
                    disabled={!useDateRange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Imbalance Warning */}
          {!isBalanced && totals && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              <p className="font-medium">⚠️ Trial Balance Imbalance Detected</p>
              <p className="text-sm mt-1">
                Debits ({formatCurrencySafe(totals.totalDebits)}) ≠ Credits ({formatCurrencySafe(totals.totalCredits)})
                <br />
                Difference: {formatCurrencySafe(imbalance)}
              </p>
              <p className="text-xs mt-2 italic">
                This indicates a data integrity issue. Please review journal entries for the selected period.
              </p>
            </div>
          )}

          {/* Balanced Success Banner */}
          {isBalanced && totals && accounts.length > 0 && (
            <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400 text-green-700 dark:text-green-400 px-4 py-3 rounded mb-6">
              <p className="font-medium">✓ Trial Balance is Balanced</p>
              <p className="text-sm mt-1">
                Total Debits = Total Credits = {formatCurrencySafe(totals.totalDebits)}
              </p>
            </div>
          )}

          {/* Trial Balance Table */}
          {accounts.length > 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                Trial Balance
                {selectedPeriodStart && !useDateRange ? (
                  <> - {formatPeriod(selectedPeriodStart)}</>
                ) : useDateRange && startDate && endDate ? (
                  <> - {startDate} to {endDate}</>
                ) : null}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Account Code</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Account Name</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Type</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Debit</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Credit</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {accounts.map((account) => (
                      <tr key={account.account_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-white">
                          {account.account_code}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {account.account_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {getAccountTypeLabel(account.account_type)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                          {(account.debit_total ?? 0) > 0 ? formatCurrencySafe(account.debit_total) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                          {(account.credit_total ?? 0) > 0 ? formatCurrencySafe(account.credit_total) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-white">
                          {formatCurrencySafe(account.ending_balance ?? account.closing_balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {totals && (
                    <tfoot className="bg-gray-50 dark:bg-gray-700 font-semibold">
                      <tr>
                        <td colSpan={3} className="px-4 py-3 text-right">Totals:</td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                          {formatCurrencySafe(totals.totalDebits)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                          {formatCurrencySafe(totals.totalCredits)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                          {isBalanced ? (
                            <span className="text-green-600 dark:text-green-400">✓ Balanced</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400">Imbalance: {formatCurrencySafe(imbalance)}</span>
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Summary by Type */}
              {totals && (
                <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Assets</p>
                    <p className="text-lg font-bold text-blue-900 dark:text-blue-300">
                      {formatCurrencySafe(totals.totalAssets)}
                    </p>
                  </div>
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Liabilities</p>
                    <p className="text-lg font-bold text-red-900 dark:text-red-300">
                      {formatCurrencySafe(totals.totalLiabilities)}
                    </p>
                  </div>
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Equity</p>
                    <p className="text-lg font-bold text-green-900 dark:text-green-300">
                      {formatCurrencySafe(totals.totalEquity)}
                    </p>
                  </div>
                  <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Net Income</p>
                    <p className={`text-lg font-bold ${(totals.netIncome ?? 0) >= 0 ? "text-green-900 dark:text-green-300" : "text-red-900 dark:text-red-300"}`}>
                      {formatCurrencySafe(totals.netIncome)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (selectedPeriodStart || (useDateRange && startDate && endDate)) ? (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 text-center">
              <p className="text-gray-500 dark:text-gray-400">No accounts with activity found for the selected period.</p>
            </div>
          ) : null}
        </div>
      </div>
    
  )
}

