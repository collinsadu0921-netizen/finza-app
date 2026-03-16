"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import LoadingScreen from "@/components/ui/LoadingScreen"
import { supabase } from "@/lib/supabaseClient"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

/** Canonical P&L — same schema as /api/accounting/reports/profit-and-loss (period, sections, totals, telemetry). */
type PnLLine = { account_code: string; account_name: string; amount: number }
type PnLSection = { key: string; label: string; lines: PnLLine[]; subtotal: number }
type ProfitLossData = {
  period: {
    period_id: string
    period_start: string
    period_end: string
    resolution_reason: string
  }
  currency: { code: string; symbol: string; name: string }
  sections: PnLSection[]
  totals: { gross_profit: number; operating_profit: number; net_profit: number }
  telemetry: {
    resolved_period_reason: string
    resolved_period_start: string
    resolved_period_end: string
    source: string
    version: number
  }
}

export default function ProfitLossPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [data, setData] = useState<ProfitLossData | null>(null)
  const [dateRange, setDateRange] = useState<"thisMonth" | "lastMonth" | "custom">("thisMonth")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [business, setBusiness] = useState<any>(null)
  const [resolvedPeriodStart, setResolvedPeriodStart] = useState<string | null>(null)

  useEffect(() => {
    updateDateRange()
  }, [dateRange])

  useEffect(() => {
    if (startDate && endDate && dateRange === "custom") {
      loadProfitLoss()
    } else if (dateRange !== "custom") {
      loadProfitLoss()
    }
  }, [startDate, endDate, dateRange])

  const updateDateRange = () => {
    const now = new Date()
    
    if (dateRange === "thisMonth") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
      setStartDate(firstDay.toISOString().split("T")[0])
      setEndDate(now.toISOString().split("T")[0])
    } else if (dateRange === "lastMonth") {
      const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0)
      setStartDate(firstDayLastMonth.toISOString().split("T")[0])
      setEndDate(lastDayLastMonth.toISOString().split("T")[0])
    }
    // For custom, keep existing dates or let user set them
  }

  const loadProfitLoss = async () => {
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
      if (dateRange === "custom" && startDate) {
        params.set("start_date", startDate)
        if (endDate) params.set("end_date", endDate)
      } else if (dateRange === "lastMonth") {
        params.set("period_start", new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().split("T")[0])
      }
      // thisMonth or no selection: no period params — server resolves (latest_activity / current_month_fallback)

      const response = await fetch(`/api/accounting/reports/profit-and-loss?${params.toString()}`)

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}))
        throw new Error(errBody.error || "Failed to load Profit & Loss report")
      }

      const raw = await response.json()
      setResolvedPeriodStart(raw.period?.period_start ?? raw.telemetry?.resolved_period_start ?? null)
      setData(raw as ProfitLossData)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load Profit & Loss report")
      setLoading(false)
    }
  }

  const { format } = useBusinessCurrency()
  const formatCurrency = (amount: number) => format(Math.abs(amount))

  const formatPeriod = () => {
    if (!data?.period?.period_start || !data?.period?.period_end) return "—"
    const start = new Date(data.period.period_start).toLocaleDateString("en-GH", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
    const end = new Date(data.period.period_end).toLocaleDateString("en-GH", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
    return `${start} – ${end}`
  }
  const revenueTotal = data ? data.sections.filter((s) => s.key === "income" || s.key === "other_income").reduce((sum, s) => sum + s.subtotal, 0) : 0
  const expensesTotal = data ? data.sections.filter((s) => s.key !== "income" && s.key !== "other_income").reduce((sum, s) => sum + s.subtotal, 0) : 0

  if (loading) {
    return (
      <ProtectedLayout>
        <LoadingScreen />
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Currency Setup Banner */}
          {!business?.default_currency && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
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
          {/* Embedded read-only indicator (Option C: Service workspace uses Accounting report) */}
          <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 dark:border-sky-800 dark:bg-sky-900/20">
            <p className="text-sm text-sky-800 dark:text-sky-200">
              Business reports — read-only. Same data as Accounting workspace. Posting and period actions are not available here.
              {business?.industry === "retail" && " View only; export is not available in Retail workspace."}
            </p>
          </div>

          {/* Header */}
          <div className="mb-8">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Profit & Loss Report
              </h1>
              <div className="flex items-center gap-2">
                {business?.default_currency && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    All amounts in {business.default_currency}
                  </p>
                )}
                {(data?.period?.period_start || resolvedPeriodStart) && business?.id && business?.industry !== "retail" && (
                  <>
                    <a
                      href={`/api/accounting/reports/profit-and-loss/export/csv?business_id=${encodeURIComponent(business.id)}&period_start=${encodeURIComponent(data?.period?.period_start || resolvedPeriodStart || "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Export CSV
                    </a>
                    <a
                      href={`/api/accounting/reports/profit-and-loss/export/pdf?business_id=${encodeURIComponent(business.id)}&period_start=${encodeURIComponent(data?.period?.period_start || resolvedPeriodStart || "")}`}
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
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              Performance report from General Ledger
            </p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Date Range Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6 border border-gray-100 dark:border-gray-700">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Period
                </label>
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as "thisMonth" | "lastMonth" | "custom")}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="thisMonth">This Month</option>
                  <option value="lastMonth">Last Month</option>
                  <option value="custom">Custom Range</option>
                </select>
              </div>
              {dateRange === "custom" && (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </>
              )}
            </div>
            {data && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Report Period: <span className="font-medium">{formatPeriod()}</span>
                  {data.telemetry?.resolved_period_reason && (
                    <span className="ml-2 text-xs text-gray-500 dark:text-gray-500">({data.telemetry.resolved_period_reason})</span>
                  )}
                </p>
              </div>
            )}
          </div>

          {data && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border border-green-200 dark:border-green-700 rounded-xl p-6">
                  <div className="text-green-900 dark:text-green-300 font-semibold text-sm mb-1">
                    Total Revenue
                  </div>
                  <div className="text-green-900 dark:text-green-300 font-bold text-2xl">
                    {formatCurrency(revenueTotal)}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 border border-red-200 dark:border-red-700 rounded-xl p-6">
                  <div className="text-red-900 dark:text-red-300 font-semibold text-sm mb-1">
                    Total Expenses
                  </div>
                  <div className="text-red-900 dark:text-red-300 font-bold text-2xl">
                    {formatCurrency(expensesTotal)}
                  </div>
                </div>
                <div
                  className={`bg-gradient-to-br ${
                    data.totals.net_profit >= 0
                      ? "from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-blue-200 dark:border-blue-700"
                      : "from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border-orange-200 dark:border-orange-700"
                  } rounded-xl p-6`}
                >
                  <div
                    className={`${
                      data.totals.net_profit >= 0
                        ? "text-blue-900 dark:text-blue-300"
                        : "text-orange-900 dark:text-orange-300"
                    } font-semibold text-sm mb-1`}
                  >
                    Net {data.totals.net_profit >= 0 ? "Profit" : "Loss"}
                  </div>
                  <div
                    className={`${
                      data.totals.net_profit >= 0
                        ? "text-blue-900 dark:text-blue-300"
                        : "text-orange-900 dark:text-orange-300"
                    } font-bold text-2xl`}
                  >
                    {formatCurrency(data.totals.net_profit)}
                  </div>
                  <div
                    className={`${
                      data.totals.net_profit >= 0
                        ? "text-blue-700 dark:text-blue-400"
                        : "text-orange-700 dark:text-orange-400"
                    } text-xs mt-1`}
                  >
                    {revenueTotal > 0 ? ((data.totals.net_profit / revenueTotal) * 100).toFixed(2) : "0.00"}% margin
                  </div>
                </div>
              </div>

              {/* Sections from canonical schema */}
              {data.sections.map((section) => (
                (section.lines.length > 0 || section.subtotal !== 0) && (
                  <div key={section.key} className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden mb-6">
                    <div className={`px-6 py-4 border-b ${section.key === "income" || section.key === "other_income" ? "bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-green-200 dark:border-green-700" : "bg-gradient-to-r from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 border-red-200 dark:border-red-700"}`}>
                      <h2 className={`text-xl font-bold ${section.key === "income" || section.key === "other_income" ? "text-green-900 dark:text-green-300" : "text-red-900 dark:text-red-300"}`}>
                        {section.label}
                      </h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Code</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Account Name</th>
                            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {section.lines.length > 0 ? (
                            section.lines.map((line, idx) => (
                              <tr key={`${section.key}-${idx}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{line.account_code}</td>
                                <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">{line.account_name}</td>
                                <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${section.key === "income" || section.key === "other_income" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                                  {formatCurrency(line.amount)}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={3} className="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                                No accounts in this section
                              </td>
                            </tr>
                          )}
                          <tr className={`font-bold ${section.key === "income" || section.key === "other_income" ? "bg-green-50 dark:bg-green-900/10" : "bg-red-50 dark:bg-red-900/10"}`}>
                            <td colSpan={2} className={`px-6 py-4 text-sm ${section.key === "income" || section.key === "other_income" ? "text-green-900 dark:text-green-300" : "text-red-900 dark:text-red-300"}`}>
                              Total {section.label}
                            </td>
                            <td className={`px-6 py-4 text-sm text-right font-bold ${section.key === "income" || section.key === "other_income" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                              {formatCurrency(section.subtotal)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              ))}

              {/* Net Profit Summary */}
              <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-lg border-2 ${data.totals.net_profit >= 0 ? "border-blue-200 dark:border-blue-700" : "border-orange-200 dark:border-orange-700"} overflow-hidden`}>
                <div className={`px-6 py-4 ${data.totals.net_profit >= 0 ? "bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20" : "bg-gradient-to-r from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20"}`}>
                  <div className="flex justify-between items-center">
                    <h2 className={`text-xl font-bold ${data.totals.net_profit >= 0 ? "text-blue-900 dark:text-blue-300" : "text-orange-900 dark:text-orange-300"}`}>
                      Net {data.totals.net_profit >= 0 ? "Profit" : "Loss"}
                    </h2>
                    <div className={`text-2xl font-bold ${data.totals.net_profit >= 0 ? "text-blue-700 dark:text-blue-400" : "text-orange-700 dark:text-orange-400"}`}>
                      {formatCurrency(data.totals.net_profit)}
                    </div>
                  </div>
                  {revenueTotal > 0 && (
                    <div className={`text-sm mt-2 ${data.totals.net_profit >= 0 ? "text-blue-700 dark:text-blue-400" : "text-orange-700 dark:text-orange-400"}`}>
                      Profit Margin: {((data.totals.net_profit / revenueTotal) * 100).toFixed(2)}%
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}














