"use client"

import { useState, useEffect } from "react"
import { useSearchParams, usePathname } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter } from "next/navigation"
import { exportToCSV, exportToExcel, ExportColumn, formatCurrencyRaw } from "@/lib/exportUtils"
import Button from "@/components/ui/Button"
import { supabase } from "@/lib/supabaseClient"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { useAccountingBusiness } from "@/lib/accounting/useAccountingBusiness"
import { hasAccountingRouteContext } from "@/lib/accounting/assertAccountingRouteContext"
import { logAccountingRouteWithoutBusinessId } from "@/lib/accounting/devContextLogger"

type AccountBalance = {
  id: string
  name: string
  code: string
  type: string
  opening_balance: number
  period_debit: number
  period_credit: number
  closing_balance: number
}

type Totals = {
  total_opening_debits: number
  total_opening_credits: number
  total_period_debits: number
  total_period_credits: number
  total_closing_debits: number
  total_closing_credits: number
}

export default function AccountingTrialBalancePage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { businessId: urlBusinessId } = useAccountingBusiness()
  const routeContextOk = hasAccountingRouteContext(pathname ?? "", urlBusinessId)
  const [loading, setLoading] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AccountBalance[]>([])
  const [byType, setByType] = useState<Record<string, AccountBalance[]>>({})
  const [totals, setTotals] = useState<Totals | null>(null)
  const [isBalanced, setIsBalanced] = useState(false)
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  })
  const [periodStatus, setPeriodStatus] = useState<string>("open")
  const [isLocked, setIsLocked] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!routeContextOk && pathname) logAccountingRouteWithoutBusinessId(pathname)
  }, [routeContextOk, pathname])

  useEffect(() => {
    loadContext()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (businessId) {
      loadTrialBalance()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, businessId])

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
      setError(err.message || "Failed to load context")
      setLoading(false)
    }
  }

  const loadTrialBalance = async () => {
    if (!businessId) return
    try {
      setLoading(true)
      const response = await fetch(`/api/accounting/trial-balance?business_id=${businessId}&period=${period}`) // FIX: dev-build
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const msg = (errorData.error as string) || "Unable to load trial balance. Please try again."
        const detail = errorData.supabase_error?.message
        throw new Error(detail ? `${msg} (${detail})` : msg)
      }

      const data = await response.json()
      setAccounts(data.accounts || [])
      setByType(data.byType || {})
      setTotals(data.totals)
      setIsBalanced(data.isBalanced)
      setPeriodStatus(data.period_status || "open")
      setIsLocked(data.is_locked || false)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Unable to load trial balance. Please try again.")
      setLoading(false)
    }
  }

  const typeLabels: Record<string, string> = {
    asset: "Assets",
    liability: "Liabilities",
    equity: "Equity",
    income: "Income",
    expense: "Expenses",
  }

  // Export trial balance to CSV
  const handleExportCSV = () => {
    try {
      if (accounts.length === 0) {
        setError("No data to export")
        return
      }

      const columns: ExportColumn<AccountBalance>[] = [
        { header: "Account Code", accessor: (acc) => acc.code || "", width: 15 },
        { header: "Account Name", accessor: (acc) => acc.name || "", width: 40 },
        {
          header: "Opening Balance",
          accessor: (acc) => Number(acc.opening_balance || 0),
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "Period Debit",
          accessor: (acc) => Number(acc.period_debit || 0),
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "Period Credit",
          accessor: (acc) => Number(acc.period_credit || 0),
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "Closing Balance",
          accessor: (acc) => Number(acc.closing_balance || 0),
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
      ]

      exportToCSV(accounts, columns, `trial-balance-${period}`)
    } catch (error: any) {
      console.error("Export error:", error)
      setError(error.message || "Failed to export trial balance")
    }
  }

  // Export trial balance to Excel
  const handleExportExcel = async () => {
    try {
      if (accounts.length === 0) {
        setError("No data to export")
        return
      }

      const columns: ExportColumn<AccountBalance>[] = [
        { header: "Account Code", accessor: (acc) => acc.code || "", width: 15 },
        { header: "Account Name", accessor: (acc) => acc.name || "", width: 40 },
        {
          header: "Opening Balance",
          accessor: (acc) => Number(acc.opening_balance || 0),
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "Period Debit",
          accessor: (acc) => Number(acc.period_debit || 0),
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "Period Credit",
          accessor: (acc) => Number(acc.period_credit || 0),
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        {
          header: "Closing Balance",
          accessor: (acc) => Number(acc.closing_balance || 0),
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
      ]

      await exportToExcel(accounts, columns, `trial-balance-${period}`)
    } catch (error: any) {
      console.error("Export error:", error)
      setError(error.message || "Failed to export trial balance")
    }
  }

  if (loading) {
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
        <div className="p-6">
          <p className="text-gray-600 dark:text-gray-400">Select a client or ensure you have an active business.</p>
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
                Trial Balance
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">Account balances for selected period</p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              />
              {isLocked && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400">
                  Period Locked
                </span>
              )}
              {periodStatus === "soft_closed" && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400">
                  Soft Closed
                </span>
              )}
              {accounts.length > 0 && (
                <>
                  <Button
                    onClick={handleExportCSV}
                    variant="outline"
                    leftIcon={
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    }
                  >
                    Export CSV
                  </Button>
                  <Button
                    onClick={handleExportExcel}
                    variant="outline"
                    leftIcon={
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    }
                  >
                    Export Excel
                  </Button>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Balance Status */}
          <div className={`mb-6 p-4 rounded-xl ${isBalanced ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700'}`}>
            <div className="flex items-center justify-between">
              <span className={`font-semibold ${isBalanced ? 'text-green-900 dark:text-green-300' : 'text-red-900 dark:text-red-300'}`}>
                {isBalanced ? "✓ Period is Balanced" : "⚠ Period is Not Balanced"}
              </span>
              {totals && (
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Period Debits: ₵{totals.total_period_debits.toFixed(2)} • Period Credits: ₵{totals.total_period_credits.toFixed(2)}
                </div>
              )}
            </div>
          </div>

          {/* Summary Totals */}
          {totals && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4">
                <div className="text-blue-900 dark:text-blue-300 font-semibold text-sm mb-1">Opening Balance</div>
                <div className="text-blue-900 dark:text-blue-300 font-bold text-xl">
                  Debits: ₵{totals.total_opening_debits.toFixed(2)}
                </div>
                <div className="text-blue-900 dark:text-blue-300 font-bold text-xl">
                  Credits: ₵{totals.total_opening_credits.toFixed(2)}
                </div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border border-green-200 dark:border-green-700 rounded-xl p-4">
                <div className="text-green-900 dark:text-green-300 font-semibold text-sm mb-1">Period Activity</div>
                <div className="text-green-900 dark:text-green-300 font-bold text-xl">
                  Debits: ₵{totals.total_period_debits.toFixed(2)}
                </div>
                <div className="text-green-900 dark:text-green-300 font-bold text-xl">
                  Credits: ₵{totals.total_period_credits.toFixed(2)}
                </div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border border-purple-200 dark:border-purple-700 rounded-xl p-4">
                <div className="text-purple-900 dark:text-purple-300 font-semibold text-sm mb-1">Closing Balance</div>
                <div className="text-purple-900 dark:text-purple-300 font-bold text-xl">
                  Debits: ₵{totals.total_closing_debits.toFixed(2)}
                </div>
                <div className="text-purple-900 dark:text-purple-300 font-bold text-xl">
                  Credits: ₵{totals.total_closing_credits.toFixed(2)}
                </div>
              </div>
            </div>
          )}

          {/* Accounts by Type */}
          <div className="space-y-6">
            {accounts.length === 0 && !error ? (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
                Accounting hasn&apos;t started yet. It will begin automatically when you post your first transaction.
              </div>
            ) : null}
            {Object.entries(byType).map(([type, typeAccounts]) => (
              typeAccounts.length > 0 && (
                <div key={type} className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-600 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">{typeLabels[type]}</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Code</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Account Name</th>
                          <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Opening Balance</th>
                          <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Period Debit</th>
                          <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Period Credit</th>
                          <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Closing Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {typeAccounts.map((account) => (
                          <tr key={account.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{account.code}</td>
                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">{account.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                              {account.opening_balance !== 0 ? (
                                <span className={`font-medium ${account.opening_balance >= 0 ? 'text-gray-900 dark:text-white' : 'text-red-600 dark:text-red-400'}`}>
                                  ₵{account.opening_balance.toFixed(2)}
                                </span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                              {account.period_debit > 0 ? (
                                <span className="font-medium text-gray-900 dark:text-white">₵{account.period_debit.toFixed(2)}</span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                              {account.period_credit > 0 ? (
                                <span className="font-medium text-gray-900 dark:text-white">₵{account.period_credit.toFixed(2)}</span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                              <span className={`font-semibold ${account.closing_balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                ₵{account.closing_balance.toFixed(2)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}

