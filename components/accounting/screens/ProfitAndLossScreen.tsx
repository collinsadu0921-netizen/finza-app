"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
import { formatCurrencySafe } from "@/lib/currency/formatCurrency"
import { buildServiceRoute } from "@/lib/service/routes"
import type { ScreenProps } from "./types"
import { downloadFileFromApi } from "@/lib/download/downloadFileFromApi"

type AccountingPeriod = {
  id: string
  business_id: string
  period_start: string
  period_end: string
  status: "open" | "soft_closed" | "locked"
}

type ReportLine = {
  account_id?: string
  account_code: string
  account_name: string
  amount: number
}

type ReportSection = {
  key: string
  lines: ReportLine[]
  subtotal: number
}

const SECTION_LABELS: Record<string, string> = {
  income:             "Revenue",
  other_income:       "Other Income",
  cost_of_sales:      "Cost of Sales",
  expenses:           "Expenses",
  operating_expenses: "Operating Expenses",
  other_expenses:     "Other Expenses",
}

function sectionLabel(key: string): string {
  return SECTION_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function PnLSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl" />
        ))}
      </div>
      <div className="h-56 bg-gray-100 dark:bg-gray-800 rounded-xl" />
      <div className="h-56 bg-gray-100 dark:bg-gray-800 rounded-xl" />
      <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl" />
    </div>
  )
}

export default function ProfitAndLossScreen({ mode, businessId }: ScreenProps) {
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

  const [incomeSections, setIncomeSections]   = useState<ReportSection[]>([])
  const [expenseSections, setExpenseSections] = useState<ReportSection[]>([])
  const [netProfit, setNetProfit]             = useState(0)
  const [revenueTotal, setRevenueTotal]       = useState(0)
  const [expenseTotal, setExpenseTotal]       = useState(0)
  const [periodLabel, setPeriodLabel]         = useState<string | null>(null)
  const [error, setError] = useState("")

  useEffect(() => { if (!businessId) setLoading(false) }, [businessId])
  useEffect(() => { if (businessId) loadPeriods() }, [businessId])
  useEffect(() => {
    if (businessId) {
      loadProfitAndLoss()
    } else {
      setIncomeSections([])
      setExpenseSections([])
      setNetProfit(0)
      setRevenueTotal(0)
      setExpenseTotal(0)
      setPeriodLabel(null)
    }
  }, [businessId, selectedPeriodStart, useDateRange, startDate, endDate])

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

  const loadProfitAndLoss = async () => {
    if (!businessId) return
    try {
      setLoading(true)
      setError("")
      let url = `/api/accounting/reports/profit-and-loss?business_id=${businessId}`
      if (selectedPeriodStart && !useDateRange) {
        url += `&period_start=${selectedPeriodStart}`
      } else if (useDateRange && startDate && endDate) {
        url += `&start_date=${startDate}&end_date=${endDate}`
      }
      const response = await fetch(url)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load profit & loss")
      }
      const data = await response.json()
      const allSections: ReportSection[] = data.sections ?? []
      const income  = allSections.filter((s) => s.key === "income" || s.key === "other_income")
      const expense = allSections.filter((s) => s.key !== "income" && s.key !== "other_income")
      setIncomeSections(income)
      setExpenseSections(expense)
      const rev = income.reduce((sum, s) => sum + s.subtotal, 0)
      const exp = expense.reduce((sum, s) => sum + s.subtotal, 0)
      setRevenueTotal(rev)
      setExpenseTotal(exp)
      setNetProfit(data.totals?.net_profit ?? 0)
      if (data.period) {
        const s = new Date(data.period.period_start)
        const e = new Date(data.period.period_end)
        setPeriodLabel(
          `${s.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} – ${e.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
        )
      } else if (useDateRange && startDate && endDate) {
        setPeriodLabel(`${startDate} – ${endDate}`)
      } else {
        setPeriodLabel(null)
      }
    } catch (err: any) {
      setError(err.message || "Failed to load profit & loss")
    } finally {
      setLoading(false)
    }
  }

  const hasData = incomeSections.length > 0 || expenseSections.length > 0

  const profitMargin = revenueTotal > 0 ? (netProfit / revenueTotal) * 100 : 0
  const isProfit = netProfit >= 0

  const buildExportUrl = (format: "csv" | "pdf") => {
    let url = `/api/accounting/reports/profit-and-loss/export/${format}?business_id=${businessId}`
    if (selectedPeriodStart && !useDateRange) {
      url += `&period_start=${selectedPeriodStart}`
    } else if (useDateRange && startDate && endDate) {
      url += `&start_date=${startDate}&end_date=${endDate}`
    }
    return url
  }

  const handleExport = async (format: "csv" | "pdf") => {
    if (!businessId) return
    if (!hasData) {
      toast.showToast("No data to export", "warning")
      return
    }
    const url = buildExportUrl(format)
    const fallback = format === "pdf" ? "profit-and-loss.pdf" : "profit-and-loss.csv"
    try {
      await downloadFileFromApi(url, {
        fallbackFilename: fallback,
        ...(format === "pdf" ? { expectedMimePrefix: "application/pdf" as const } : {}),
      })
    } catch (err: unknown) {
      toast.showToast(
        err instanceof Error ? err.message : format === "pdf" ? "Could not download PDF" : "Could not download CSV",
        "error"
      )
    }
  }

  const backUrl = mode === "service" ? buildServiceRoute("/service/accounting", businessId) : "/accounting"

  const formatPeriodOption = (p: AccountingPeriod) => {
    const d = new Date(p.period_start)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")} (${p.status})`
  }

  if (!routeContextOk || noContext) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-6 text-amber-800 dark:text-amber-200">
            <p className="font-medium">No business context available.</p>
            <p className="text-sm mt-1">Select a client or ensure you have an active business.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-6">
          <button onClick={() => router.push(backUrl)} className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2 block">
            ← Back to Accounting
          </button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Profit & Loss</h1>
              {periodLabel && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Period: {periodLabel}</p>
              )}
            </div>
            {hasData && (
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleExport("csv")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  CSV
                </button>
                <button
                  onClick={() => handleExport("pdf")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-sm font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  PDF
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Segmented mode toggle */}
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-sm">
              <button
                onClick={() => { setUseDateRange(false); setStartDate(""); setEndDate("") }}
                className={`px-3 py-1.5 font-medium transition-colors ${!useDateRange ? "bg-blue-600 text-white" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
              >
                Accounting Period
              </button>
              <button
                onClick={() => { setUseDateRange(true); setSelectedPeriodStart(null) }}
                className={`px-3 py-1.5 font-medium transition-colors ${useDateRange ? "bg-blue-600 text-white" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
              >
                Custom Range
              </button>
            </div>

            {!useDateRange ? (
              <select
                value={selectedPeriodStart || ""}
                onChange={(e) => { setSelectedPeriodStart(e.target.value || null); setError("") }}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Latest period</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.period_start}>{formatPeriodOption(p)}</option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setError("") }}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-gray-400 text-sm">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); setError("") }}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <PnLSkeleton />
        ) : hasData ? (
          <>
            {/* KPI Summary Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Total Revenue</p>
                <p className="text-lg font-bold text-green-700 dark:text-green-400">{formatCurrencySafe(revenueTotal)}</p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Total Expenses</p>
                <p className="text-lg font-bold text-red-700 dark:text-red-400">{formatCurrencySafe(expenseTotal)}</p>
              </div>
              <div className={`bg-white dark:bg-gray-800 rounded-xl border px-4 py-3 ${isProfit ? "border-green-300 dark:border-green-700" : "border-red-300 dark:border-red-700"}`}>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{isProfit ? "Net Profit" : "Net Loss"}</p>
                <p className={`text-lg font-bold ${isProfit ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                  {formatCurrencySafe(Math.abs(netProfit))}
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Profit Margin</p>
                <p className={`text-lg font-bold ${profitMargin >= 0 ? "text-blue-700 dark:text-blue-400" : "text-red-700 dark:text-red-400"}`}>
                  {revenueTotal > 0 ? `${profitMargin.toFixed(1)}%` : "—"}
                </p>
              </div>
            </div>

            {/* Report Body */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">

              {/* Income Sections */}
              {incomeSections.map((section, si) => (
                <div key={section.key}>
                  {/* Section header */}
                  <div className="flex items-center justify-between px-6 py-3 bg-green-50 dark:bg-green-900/20 border-b border-green-100 dark:border-green-800">
                    <span className="text-sm font-semibold text-green-800 dark:text-green-300 uppercase tracking-wide">
                      {sectionLabel(section.key)}
                    </span>
                  </div>
                  {/* Lines */}
                  <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
                    {section.lines.map((line, i) => (
                      <div key={line.account_id || `${section.key}-${i}`} className="flex items-center justify-between px-6 py-2.5 hover:bg-gray-50/60 dark:hover:bg-gray-700/20">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs font-mono text-gray-400 dark:text-gray-500 shrink-0 w-14">{line.account_code}</span>
                          <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{line.account_name}</span>
                        </div>
                        <span className="text-sm font-medium text-gray-900 dark:text-white shrink-0 ml-4">{formatCurrencySafe(line.amount)}</span>
                      </div>
                    ))}
                  </div>
                  {/* Section subtotal */}
                  <div className="flex items-center justify-between px-6 py-3 bg-green-50/60 dark:bg-green-900/10 border-t border-green-100 dark:border-green-800/60">
                    <span className="text-sm font-semibold text-green-800 dark:text-green-300">Total {sectionLabel(section.key)}</span>
                    <span className="text-sm font-bold text-green-700 dark:text-green-400">{formatCurrencySafe(section.subtotal)}</span>
                  </div>
                  {/* Revenue grand total after last income section */}
                  {si === incomeSections.length - 1 && incomeSections.length > 1 && (
                    <div className="flex items-center justify-between px-6 py-3 bg-green-100 dark:bg-green-900/20 border-t border-green-200 dark:border-green-700">
                      <span className="text-sm font-bold text-green-900 dark:text-green-200">Total Revenue</span>
                      <span className="text-base font-bold text-green-700 dark:text-green-300">{formatCurrencySafe(revenueTotal)}</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Divider between income and expenses */}
              {incomeSections.length > 0 && expenseSections.length > 0 && (
                <div className="border-t-2 border-gray-200 dark:border-gray-600" />
              )}

              {/* Expense Sections */}
              {expenseSections.map((section, si) => (
                <div key={section.key}>
                  <div className="flex items-center justify-between px-6 py-3 bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800">
                    <span className="text-sm font-semibold text-red-800 dark:text-red-300 uppercase tracking-wide">
                      {sectionLabel(section.key)}
                    </span>
                  </div>
                  <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
                    {section.lines.map((line, i) => (
                      <div key={line.account_id || `${section.key}-${i}`} className="flex items-center justify-between px-6 py-2.5 hover:bg-gray-50/60 dark:hover:bg-gray-700/20">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs font-mono text-gray-400 dark:text-gray-500 shrink-0 w-14">{line.account_code}</span>
                          <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{line.account_name}</span>
                        </div>
                        <span className="text-sm font-medium text-gray-900 dark:text-white shrink-0 ml-4">{formatCurrencySafe(line.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between px-6 py-3 bg-red-50/60 dark:bg-red-900/10 border-t border-red-100 dark:border-red-800/60">
                    <span className="text-sm font-semibold text-red-800 dark:text-red-300">Total {sectionLabel(section.key)}</span>
                    <span className="text-sm font-bold text-red-700 dark:text-red-400">{formatCurrencySafe(section.subtotal)}</span>
                  </div>
                  {si === expenseSections.length - 1 && expenseSections.length > 1 && (
                    <div className="flex items-center justify-between px-6 py-3 bg-red-100 dark:bg-red-900/20 border-t border-red-200 dark:border-red-700">
                      <span className="text-sm font-bold text-red-900 dark:text-red-200">Total Expenses</span>
                      <span className="text-base font-bold text-red-700 dark:text-red-300">{formatCurrencySafe(expenseTotal)}</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Net Profit / Loss row */}
              <div className={`flex items-center justify-between px-6 py-4 border-t-2 ${isProfit ? "border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20" : "border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-900/20"}`}>
                <div>
                  <span className={`text-base font-bold ${isProfit ? "text-green-900 dark:text-green-200" : "text-red-900 dark:text-red-200"}`}>
                    Net {isProfit ? "Profit" : "Loss"}
                  </span>
                  {revenueTotal > 0 && (
                    <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">
                      {profitMargin.toFixed(1)}% margin
                    </span>
                  )}
                </div>
                <span className={`text-xl font-bold ${isProfit ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
                  {formatCurrencySafe(Math.abs(netProfit))}
                </span>
              </div>
            </div>
          </>
        ) : (selectedPeriodStart || (useDateRange && startDate && endDate)) ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">No income or expense activity found for the selected period.</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
