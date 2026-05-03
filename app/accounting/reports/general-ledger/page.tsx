"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { useAccountingBusiness } from "@/lib/accounting/useAccountingBusiness"
import { hasAccountingRouteContext } from "@/lib/accounting/assertAccountingRouteContext"
import { logAccountingRouteWithoutBusinessId } from "@/lib/accounting/devContextLogger"
import { getUserRole } from "@/lib/userRoles"
import { isUserAccountantReadonly } from "@/lib/userRoles"
import { useToast } from "@/components/ui/ToastProvider"
import { downloadFileFromApi } from "@/lib/download/downloadFileFromApi"
import { formatCurrencySafe } from "@/lib/currency/formatCurrency"

type AccountingPeriod = {
  id: string
  business_id: string
  period_start: string
  period_end: string
  status: "open" | "soft_closed" | "locked"
}

type Account = {
  id: string
  code: string
  name: string
  type: string
}

type LedgerLine = {
  entry_date: string
  journal_entry_id: string
  journal_entry_description: string
  reference_type: string | null
  reference_id: string | null
  line_id: string
  line_description: string | null
  debit: number
  credit: number
  running_balance: number
}

export default function GeneralLedgerReportPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { businessId: urlBusinessId } = useAccountingBusiness()
  const routeContextOk = hasAccountingRouteContext(pathname ?? "", urlBusinessId)
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [selectedPeriodStart, setSelectedPeriodStart] = useState<string | null>(null)
  const [useDateRange, setUseDateRange] = useState(false)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [lines, setLines] = useState<LedgerLine[]>([])
  const [account, setAccount] = useState<Account | null>(null)
  const [totals, setTotals] = useState<any>(null)
  const [error, setError] = useState("")
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<{
    entry_date: string
    journal_entry_id: string
    line_id: string
  } | null>(null)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    if (!routeContextOk && pathname) logAccountingRouteWithoutBusinessId(pathname)
  }, [routeContextOk, pathname])

  useEffect(() => {
    loadContext()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (businessId) {
      loadPeriods()
      loadAccounts()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  useEffect(() => {
    if (businessId && selectedAccountId && (selectedPeriodStart || (useDateRange && startDate && endDate))) {
      loadGeneralLedger(true) // Reset and load first page
    } else {
      setLines([])
      setAccount(null)
      setTotals(null)
      setNextCursor(null)
      setHasMore(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, selectedAccountId, selectedPeriodStart, useDateRange, startDate, endDate])

  const loadContext = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setError("Not authenticated")
        setLoading(false)
        return
      }
      const ctx = await resolveAccountingContext({ supabase, userId: user.id, searchParams, source: "workspace" })
      if ("error" in ctx) {
        setNoContext(true)
        setLoading(false)
        return
      }
      setBusinessId(ctx.businessId)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load business")
      setLoading(false)
    }
  }

  const loadPeriods = async () => {
    if (!businessId) return
    try {
      const response = await fetch(`/api/accounting/periods?business_id=${businessId}`)
      if (!response.ok) throw new Error("Failed to load periods")
      const data = await response.json()
      setPeriods(data.periods || [])
    } catch (err: any) {
      console.error("Error loading periods:", err)
    }
  }

  const loadAccounts = async () => {
    if (!businessId) return
    try {
      const response = await fetch(`/api/accounting/coa?business_id=${businessId}`)
      if (!response.ok) throw new Error("Failed to load accounts")
      const data = await response.json()
      // For general ledger, include ALL accounts (all types, system + non-system)
      setAccounts(data.accounts || [])
    } catch (err: any) {
      console.error("Error loading accounts:", err)
    }
  }

  const loadGeneralLedger = async (reset: boolean = false) => {
    if (!businessId || !selectedAccountId) return
    if (!selectedPeriodStart && !(useDateRange && startDate && endDate)) return

    try {
      if (reset) {
        setLoading(true)
        setLines([])
        setNextCursor(null)
        setHasMore(false)
      } else {
        setLoadingMore(true)
      }
      setError("")

      let url = `/api/accounting/reports/general-ledger?business_id=${businessId}&account_id=${selectedAccountId}&limit=100`
      if (selectedPeriodStart && !useDateRange) {
        url += `&period_start=${selectedPeriodStart}`
      } else if (useDateRange && startDate && endDate) {
        url += `&start_date=${startDate}&end_date=${endDate}`
      }

      // Add cursor if loading more (only entry_date, journal_entry_id, line_id)
      if (!reset && nextCursor) {
        url += `&cursor_entry_date=${nextCursor.entry_date}&cursor_journal_entry_id=${nextCursor.journal_entry_id}&cursor_line_id=${nextCursor.line_id}`
      }

      const response = await fetch(url)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load general ledger")
      }

      const data = await response.json()
      setAccount(data.account)
      
      if (reset) {
        setLines(data.lines || [])
        setTotals(data.totals)
      } else {
        // Append new lines
        setLines((prevLines) => [...prevLines, ...(data.lines || [])])
      }

      // Update pagination state
      if (data.pagination) {
        setHasMore(data.pagination.has_more || false)
        setNextCursor(data.pagination.next_cursor || null)
      } else {
        setHasMore(false)
        setNextCursor(null)
      }

      setLoading(false)
      setLoadingMore(false)
    } catch (err: any) {
      setError(err.message || "Failed to load general ledger")
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const handleLoadMore = () => {
    if (!loadingMore && hasMore && nextCursor) {
      loadGeneralLedger(false)
    }
  }

  const formatPeriod = (periodStart: string): string => {
    const date = new Date(periodStart)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    return `${year}-${month}`
  }

  const getReferenceLabel = (referenceType: string | null): string => {
    if (!referenceType) return "Manual Entry"
    const labels: Record<string, string> = {
      invoice: "Invoice",
      payment: "Payment",
      credit_note: "Credit Note",
      bill: "Bill",
      bill_payment: "Bill Payment",
      expense: "Expense",
      adjustment: "Adjustment",
      opening_balance: "Opening Balance",
      carry_forward: "Carry-Forward",
      manual: "Manual Entry",
    }
    return labels[referenceType] || referenceType
  }

  const handleExportCSV = async () => {
    if (!businessId || !selectedAccountId) {
      toast.showToast("Please select an account first", "warning")
      return
    }
    if (!selectedPeriodStart && !(useDateRange && startDate && endDate)) {
      toast.showToast("Please select a period or date range first", "warning")
      return
    }

    let url = `/api/accounting/reports/general-ledger/export/csv?business_id=${businessId}&account_id=${selectedAccountId}`
    if (selectedPeriodStart && !useDateRange) {
      url += `&period_start=${selectedPeriodStart}`
    } else if (useDateRange && startDate && endDate) {
      url += `&start_date=${startDate}&end_date=${endDate}`
    }

    try {
      await downloadFileFromApi(url, { fallbackFilename: "general-ledger.csv" })
    } catch (err: unknown) {
      toast.showToast(err instanceof Error ? err.message : "Could not download CSV", "error")
    }
  }

  const handleExportPDF = async () => {
    if (!businessId || !selectedAccountId) {
      toast.showToast("Please select an account first", "warning")
      return
    }
    if (!selectedPeriodStart && !(useDateRange && startDate && endDate)) {
      toast.showToast("Please select a period or date range first", "warning")
      return
    }

    let url = `/api/accounting/reports/general-ledger/export/pdf?business_id=${businessId}&account_id=${selectedAccountId}`
    if (selectedPeriodStart && !useDateRange) {
      url += `&period_start=${selectedPeriodStart}`
    } else if (useDateRange && startDate && endDate) {
      url += `&start_date=${startDate}&end_date=${endDate}`
    }

    try {
      await downloadFileFromApi(url, {
        fallbackFilename: "general-ledger.pdf",
        expectedMimePrefix: "application/pdf",
      })
    } catch (err: unknown) {
      toast.showToast(err instanceof Error ? err.message : "Could not download PDF", "error")
    }
  }

  if (loading && !account) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  if (!routeContextOk || noContext) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-6 text-amber-800 dark:text-amber-200">
              <p className="font-medium">Select a client or ensure you have an active business.</p>
              <p className="text-sm mt-1">No business context is available.</p>
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
                onClick={() => router.push("/accounting")}
                className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
              >
                ← Back to Accounting
              </button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                General Ledger
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                View detailed journal entries for a selected account. Ledger-only report.
              </p>
            </div>
            {account && lines.length > 0 && (
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

          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Account *
                </label>
                <select
                  value={selectedAccountId || ""}
                  onChange={(e) => {
                    setSelectedAccountId(e.target.value || null)
                    setError("")
                  }}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">-- Select Account --</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.code} - {acc.name} ({acc.type})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center mb-2">
                  <input
                    type="radio"
                    checked={!useDateRange}
                    onChange={() => setUseDateRange(false)}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Period
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
                    onChange={() => setUseDateRange(true)}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Date Range
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

          {/* General Ledger Table */}
          {account && lines.length > 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                General Ledger: {account.code} - {account.name}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Description</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Reference</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Debit</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Credit</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {lines.map((line) => (
                      <tr key={line.line_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {new Date(line.entry_date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {line.line_description || line.journal_entry_description}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {getReferenceLabel(line.reference_type)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                          {(line.debit ?? 0) > 0 ? formatCurrencySafe(line.debit) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                          {(line.credit ?? 0) > 0 ? formatCurrencySafe(line.credit) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-white">
                          {formatCurrencySafe(line.running_balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {totals && (
                    <tfoot className="bg-gray-50 dark:bg-gray-700 font-semibold">
                      <tr>
                        <td colSpan={3} className="px-4 py-3 text-right">Totals / Final Balance:</td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                          {formatCurrencySafe(totals.total_debit)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                          {formatCurrencySafe(totals.total_credit)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                          {formatCurrencySafe(totals.final_balance)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Load More Button */}
              {hasMore && (
                <div className="mt-4 text-center">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                  >
                    {loadingMore ? "Loading..." : "Load More"}
                  </button>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    Showing {lines.length} entries. {hasMore ? "Click to load more." : "End of results."}
                  </p>
                </div>
              )}

              {!hasMore && lines.length > 0 && (
                <div className="mt-4 text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    End of results. Showing {lines.length} total entries.
                  </p>
                </div>
              )}
            </div>
          ) : selectedAccountId && (selectedPeriodStart || (useDateRange && startDate && endDate)) ? (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 text-center">
              <p className="text-gray-500 dark:text-gray-400">No journal entries found for the selected account and period.</p>
            </div>
          ) : null}
        </div>
      </div>
    </ProtectedLayout>
  )
}
