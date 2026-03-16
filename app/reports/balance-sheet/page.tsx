"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { supabase } from "@/lib/supabaseClient"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type AccountBalance = {
  id: string
  name: string
  code: string
  type: string
  debit: number
  credit: number
  balance: number
}

type BalanceSheetData = {
  asOfDate: string
  period?: {
    startDate: string
    endDate: string
  } | null
  assets: AccountBalance[]
  liabilities: AccountBalance[]
  equity: AccountBalance[]
  assetGroups?: {
    currentAssets: AccountBalance[]
    fixedAssets: AccountBalance[]
    accumulatedDepreciation: AccountBalance | null
    otherAssets: AccountBalance[]
  }
  totals: {
    totalCurrentAssets?: number
    grossFixedAssets?: number
    accumulatedDepreciation?: number
    netFixedAssets?: number
    totalOtherAssets?: number
    totalAssets: number
    totalLiabilities: number
    totalEquity: number
    currentPeriodNetIncome: number
    adjustedEquity: number
    totalLiabilitiesAndEquity: number
    balancingDifference: number
    isBalanced: boolean
  }
}

function getSafeRowKey(row: AccountBalance, index: number): string {
  if (row?.id && row.id.trim() !== "") return row.id
  return `${row?.code ?? "row"}-${index}`
}

export default function BalanceSheetPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<BalanceSheetData | null>(null)
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split("T")[0])
  const [netIncomePeriod, setNetIncomePeriod] = useState<"allTime" | "thisMonth" | "custom">("allTime")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [error, setError] = useState("")
  const [business, setBusiness] = useState<any>(null)
  const [resolvedPeriodStart, setResolvedPeriodStart] = useState<string | null>(null)

  useEffect(() => {
    updateNetIncomePeriod()
  }, [netIncomePeriod])

  useEffect(() => {
    loadBalanceSheet()
  }, [asOfDate, startDate, endDate, netIncomePeriod])

  const updateNetIncomePeriod = () => {
    const now = new Date()
    
    if (netIncomePeriod === "thisMonth") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
      setStartDate(firstDay.toISOString().split("T")[0])
      setEndDate(now.toISOString().split("T")[0])
    } else if (netIncomePeriod === "allTime") {
      setStartDate("")
      setEndDate("")
    }
    // For custom, keep existing dates or let user set them
  }

  const loadBalanceSheet = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setError("Not authenticated")
        setLoading(false)
        return
      }
      const ctx = await resolveAccountingContext({
        supabase,
        userId: user.id,
        searchParams,
        pathname: typeof window !== "undefined" ? window.location.pathname : undefined,
        source: "reports",
      })
      if ("error" in ctx) {
        setError("Client not selected. Use Control Tower or select a client.")
        setBusiness(null)
        setLoading(false)
        return
      }
      setBusiness({ id: ctx.businessId })

      const params = new URLSearchParams({ business_id: ctx.businessId, context: "embedded" })
      if (asOfDate) params.set("as_of_date", asOfDate)

      const response = await fetch(`/api/accounting/reports/balance-sheet?${params.toString()}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to load balance sheet")
      }

      const raw = await response.json()
      const flattenLines = (groups: { key: string; label: string; lines: { account_code: string; account_name: string; amount: number }[]; subtotal: number }[]) =>
        groups.flatMap((g) => g.lines.map((l) => ({ id: "", code: l.account_code, name: l.account_name, type: "", debit: 0, credit: 0, balance: l.amount })))
      const assetsSection = raw.sections?.find((s: { key: string }) => s.key === "assets")
      const liabSection = raw.sections?.find((s: { key: string }) => s.key === "liabilities")
      const equitySection = raw.sections?.find((s: { key: string }) => s.key === "equity")
      const balanceSheetData: BalanceSheetData = {
        asOfDate: raw.as_of_date ?? raw.period?.period_end ?? asOfDate,
        period: raw.period ? { startDate: raw.period.period_start, endDate: raw.period.period_end } : null,
        assets: assetsSection ? flattenLines(assetsSection.groups ?? []) : [],
        liabilities: liabSection ? flattenLines(liabSection.groups ?? []) : [],
        equity: equitySection ? flattenLines(equitySection.groups ?? []) : [],
        assetGroups: assetsSection?.groups ? {
          currentAssets: (assetsSection.groups.find((g: { key: string }) => g.key === "current_assets")?.lines ?? []).map((l: { account_code: string; account_name: string; amount: number }) => ({ id: "", code: l.account_code, name: l.account_name, type: "asset", debit: 0, credit: 0, balance: l.amount })),
          fixedAssets: (assetsSection.groups.find((g: { key: string }) => g.key === "fixed_assets")?.lines ?? []).map((l: { account_code: string; account_name: string; amount: number }) => ({ id: "", code: l.account_code, name: l.account_name, type: "asset", debit: 0, credit: 0, balance: l.amount })),
          accumulatedDepreciation: null,
          otherAssets: (assetsSection.groups.find((g: { key: string }) => g.key === "other_assets")?.lines ?? []).map((l: { account_code: string; account_name: string; amount: number }) => ({ id: "", code: l.account_code, name: l.account_name, type: "asset", debit: 0, credit: 0, balance: l.amount })),
        } : undefined,
        totals: {
          totalAssets: raw.totals?.assets ?? 0,
          totalLiabilities: raw.totals?.liabilities ?? 0,
          totalEquity: raw.totals?.equity ?? 0,
          currentPeriodNetIncome: 0,
          adjustedEquity: raw.totals?.liabilities_plus_equity ? (raw.totals.liabilities_plus_equity - (raw.totals?.liabilities ?? 0)) : 0,
          totalLiabilitiesAndEquity: raw.totals?.liabilities_plus_equity ?? 0,
          balancingDifference: raw.totals?.imbalance ?? 0,
          isBalanced: raw.totals?.is_balanced ?? true,
        },
      }
      setData(balanceSheetData)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load balance sheet")
      setLoading(false)
    }
  }

  const { format } = useBusinessCurrency()
  const formatCurrency = (amount: number) => format(Math.abs(amount))

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <div className="max-w-7xl mx-auto">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-64"></div>
              <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  if (error) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <div className="max-w-7xl mx-auto">
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-200 dark:border-red-800">
              <p className="font-semibold">Error</p>
              <p>{error}</p>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  if (!data) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <div className="max-w-7xl mx-auto">
            <p>No data available</p>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          {/* Embedded read-only indicator (Option C: Service workspace uses Accounting report) */}
          <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 dark:border-sky-800 dark:bg-sky-900/20">
            <p className="text-sm text-sky-800 dark:text-sky-200">
              Business reports — read-only. Same data as Accounting workspace. Posting and period actions are not available here.
              {business?.industry === "retail" && " View only; export is not available in Retail workspace."}
            </p>
          </div>

          {/* Currency Setup Banner */}
          {!business?.default_currency && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-300 mb-1">Currency Not Configured</h3>
                  <p className="text-sm text-yellow-700 dark:text-yellow-400 mb-3">
                    Please set your business currency in Business Profile to display amounts correctly.
                  </p>
                  <button
                    onClick={() => router.push("/settings/business-profile")}
                    className="text-sm font-medium text-yellow-800 dark:text-yellow-300 hover:text-yellow-900 dark:hover:text-yellow-200 underline"
                  >
                    Go to Business Profile →
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* Header */}
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Balance Sheet</h1>
              <div className="flex items-center gap-2">
                {business?.default_currency && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    All amounts in {business.default_currency}
                  </p>
                )}
                {business?.id && business?.industry !== "retail" && (
                  <>
                    <a
                      href={`/api/accounting/reports/balance-sheet/export/csv?business_id=${encodeURIComponent(business.id)}&as_of_date=${encodeURIComponent(data.asOfDate)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Export CSV
                    </a>
                    <a
                      href={`/api/accounting/reports/balance-sheet/export/pdf?business_id=${encodeURIComponent(business.id)}&as_of_date=${encodeURIComponent(data.asOfDate)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Export PDF
                    </a>
                  </>
                )}
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Financial position as of {new Date(data.asOfDate).toLocaleDateString("en-GH", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>

          {/* Date Selection */}
          <div className="mb-6 space-y-4">
            <div>
              <label htmlFor="asOfDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Balance Sheet As of Date
              </label>
              <input
                type="date"
                id="asOfDate"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Account balances are calculated as of this date
              </p>
            </div>
            
            {/* Net Income Period Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Net Income Period (to match P&L)
              </label>
              <select
                value={netIncomePeriod}
                onChange={(e) => setNetIncomePeriod(e.target.value as "allTime" | "thisMonth" | "custom")}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-2"
              >
                <option value="allTime">All Time (cumulative)</option>
                <option value="thisMonth">This Month</option>
                <option value="custom">Custom Period</option>
              </select>
              {netIncomePeriod === "custom" && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                  </div>
                </div>
              )}
              {data?.period && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Net Income calculated for: {new Date(data.period.startDate).toLocaleDateString()} to {new Date(data.period.endDate).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          {/* Balance Sheet Report */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm dark:shadow-[0_1px_2px_rgba(0,0,0,0.1)] overflow-hidden">
            <div className="p-6">
              {/* Assets Section */}
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">ASSETS</h2>
                {data.assets.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">No asset accounts</p>
                ) : (
                  <div className="space-y-4">
                    {/* Current Assets */}
                    {data.assetGroups?.currentAssets && data.assetGroups.currentAssets.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase">Current Assets</h3>
                        <div className="space-y-2 ml-4">
                          {data.assetGroups.currentAssets.map((account, index) => (
                            <div
                              key={getSafeRowKey(account, index)}
                              className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                                  {account.code}
                                </span>
                                <span className="text-sm text-gray-900 dark:text-white">{account.name}</span>
                              </div>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(account.balance)}
                              </span>
                            </div>
                          ))}
                          {data.totals.totalCurrentAssets !== undefined && (
                            <div className="flex justify-between items-center py-2 mt-2 border-t border-gray-300 dark:border-gray-600">
                              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total Current Assets</span>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(data.totals.totalCurrentAssets)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Fixed Assets */}
                    {data.assetGroups?.fixedAssets && data.assetGroups.fixedAssets.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase">Fixed Assets</h3>
                        <div className="space-y-2 ml-4">
                          {data.assetGroups.fixedAssets.map((account, index) => (
                            <div
                              key={getSafeRowKey(account, index)}
                              className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                                  {account.code}
                                </span>
                                <span className="text-sm text-gray-900 dark:text-white">{account.name}</span>
                              </div>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(account.balance)}
                              </span>
                            </div>
                          ))}
                          {data.totals.grossFixedAssets !== undefined && (
                            <div className="flex justify-between items-center py-2 mt-2 border-t border-gray-300 dark:border-gray-600">
                              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Gross Fixed Assets</span>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(data.totals.grossFixedAssets)}
                              </span>
                            </div>
                          )}
                          {data.assetGroups.accumulatedDepreciation && data.totals.accumulatedDepreciation !== undefined && data.totals.accumulatedDepreciation > 0 && (
                            <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                                  {data.assetGroups.accumulatedDepreciation.code}
                                </span>
                                <span className="text-sm text-gray-900 dark:text-white">
                                  Less: {data.assetGroups.accumulatedDepreciation.name}
                                </span>
                              </div>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                ({formatCurrency(data.totals.accumulatedDepreciation)})
                              </span>
                            </div>
                          )}
                          {data.totals.netFixedAssets !== undefined && (
                            <div className="flex justify-between items-center py-2 border-t border-gray-300 dark:border-gray-600">
                              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Net Fixed Assets</span>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(data.totals.netFixedAssets)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Other Assets */}
                    {data.assetGroups?.otherAssets && data.assetGroups.otherAssets.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase">Other Assets</h3>
                        <div className="space-y-2 ml-4">
                          {data.assetGroups.otherAssets.map((account, index) => (
                            <div
                              key={getSafeRowKey(account, index)}
                              className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                                  {account.code}
                                </span>
                                <span className="text-sm text-gray-900 dark:text-white">{account.name}</span>
                              </div>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(account.balance)}
                              </span>
                            </div>
                          ))}
                          {data.totals.totalOtherAssets !== undefined && (
                            <div className="flex justify-between items-center py-2 mt-2 border-t border-gray-300 dark:border-gray-600">
                              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total Other Assets</span>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(data.totals.totalOtherAssets)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Fallback: If assetGroups not available, show all assets */}
                    {!data.assetGroups && (
                      <div className="space-y-2">
                        {data.assets.map((account, index) => (
                          <div
                            key={getSafeRowKey(account, index)}
                            className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                                {account.code}
                              </span>
                              <span className="text-sm text-gray-900 dark:text-white">{account.name}</span>
                            </div>
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                              {formatCurrency(account.balance)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Total Assets */}
                    <div className="flex justify-between items-center py-3 mt-4 border-t-2 border-gray-900 dark:border-gray-100">
                      <span className="text-base font-bold text-gray-900 dark:text-white">Total Assets</span>
                      <span className="text-base font-bold text-gray-900 dark:text-white">
                        {formatCurrency(data.totals.totalAssets)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Liabilities Section */}
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">LIABILITIES</h2>
                {data.liabilities.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">No liability accounts</p>
                ) : (
                  <div className="space-y-2">
                    {data.liabilities.map((account, index) => (
                      <div
                        key={getSafeRowKey(account, index)}
                        className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                            {account.code}
                          </span>
                          <span className="text-sm text-gray-900 dark:text-white">{account.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {formatCurrency(account.balance)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center py-3 mt-4 border-t-2 border-gray-900 dark:border-gray-100">
                      <span className="text-base font-bold text-gray-900 dark:text-white">Total Liabilities</span>
                      <span className="text-base font-bold text-gray-900 dark:text-white">
                        {formatCurrency(data.totals.totalLiabilities)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Equity Section */}
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">EQUITY</h2>
                {data.equity.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">No equity accounts</p>
                ) : (
                  <div className="space-y-2">
                    {data.equity.map((account, index) => (
                      <div
                        key={getSafeRowKey(account, index)}
                        className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-16">
                            {account.code}
                          </span>
                          <span className="text-sm text-gray-900 dark:text-white">{account.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {formatCurrency(account.balance)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center py-3 mt-4 border-t-2 border-gray-900 dark:border-gray-100">
                      <span className="text-base font-bold text-gray-900 dark:text-white">Total Equity (before closing)</span>
                      <span className="text-base font-bold text-gray-900 dark:text-white">
                        {formatCurrency(data.totals.totalEquity)}
                      </span>
                    </div>
                    {Math.abs(data.totals.currentPeriodNetIncome) >= 0.01 && (
                      <>
                        <div className="flex justify-between items-center py-2 mt-2 border-t border-gray-200 dark:border-gray-700">
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            Current Period Net {data.totals.currentPeriodNetIncome >= 0 ? "Income" : "Loss"}
                          </span>
                          <span className={`text-sm font-medium ${data.totals.currentPeriodNetIncome >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                            {formatCurrency(data.totals.currentPeriodNetIncome)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-t border-gray-900 dark:border-gray-100">
                          <span className="text-base font-bold text-gray-900 dark:text-white">Adjusted Equity (after closing)</span>
                          <span className="text-base font-bold text-gray-900 dark:text-white">
                            {formatCurrency(data.totals.adjustedEquity)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Total Liabilities + Equity */}
              <div className="flex justify-between items-center py-4 mt-6 border-t-2 border-gray-900 dark:border-gray-100">
                <span className="text-lg font-bold text-gray-900 dark:text-white">Total Liabilities + Equity</span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  {formatCurrency(data.totals.totalLiabilitiesAndEquity)}
                </span>
              </div>

              {/* Balance Verification */}
              {Math.abs(data.totals.balancingDifference) >= 0.01 && (
                <div className={`mt-4 p-4 rounded-lg border ${
                  data.totals.isBalanced 
                    ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                    : "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
                }`}>
                  {data.totals.isBalanced ? (
                    <p className="text-sm text-green-800 dark:text-green-200">
                      <strong>✓ Balanced:</strong> The balance sheet balances after including current period net income in equity. 
                      To make this permanent, run Year-End Close from the Trial Balance page.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-yellow-800 dark:text-yellow-200">
                        <strong>Note:</strong> Remaining balance sheet difference: {formatCurrency(data.totals.balancingDifference)}.
                        This may indicate:
                      </p>
                      <ul className="text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside ml-2">
                        <li>Unbalanced journal entries (debits don't equal credits)</li>
                        <li>Missing journal entries for some transactions</li>
                        <li>Data inconsistencies in the ledger</li>
                      </ul>
                      <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                        Check the Trial Balance to verify all entries are balanced.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}

