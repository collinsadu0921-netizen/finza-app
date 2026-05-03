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

type BSLine = {
  account_id?: string
  account_code: string
  account_name: string
  amount: number
}

type BSGroup = {
  key: string
  label: string
  lines: BSLine[]
  subtotal: number
}

type BSSection = {
  key: string
  groups: BSGroup[]
  subtotal: number
}

type Totals = {
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  adjustedEquity: number
  totalLiabilitiesAndEquity: number
  balancingDifference: number
  isBalanced: boolean
  currentPeriodNetIncome: number
}

const GROUP_LABEL_MAP: Record<string, string> = {
  current_assets:          "Current Assets",
  non_current_assets:      "Non-Current Assets",
  fixed_assets:            "Fixed Assets",
  intangible_assets:       "Intangible Assets",
  other_assets:            "Other Assets",
  current_liabilities:     "Current Liabilities",
  non_current_liabilities: "Non-Current Liabilities",
  long_term_liabilities:   "Long-Term Liabilities",
  share_capital:           "Share Capital",
  retained_earnings:       "Retained Earnings",
  other_equity:            "Other Equity",
  reserves:                "Reserves",
}

function groupLabel(key: string): string {
  return GROUP_LABEL_MAP[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function BSSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-72 bg-gray-100 dark:bg-gray-800 rounded-xl" />
        <div className="space-y-4">
          <div className="h-44 bg-gray-100 dark:bg-gray-800 rounded-xl" />
          <div className="h-44 bg-gray-100 dark:bg-gray-800 rounded-xl" />
        </div>
      </div>
      <div className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl" />
    </div>
  )
}

function SectionPanel({
  section,
  accentColor,
  totalLabel,
}: {
  section: BSSection
  accentColor: "blue" | "red" | "green"
  totalLabel: string
}) {
  const colors = {
    blue:  { header: "bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800 text-blue-800 dark:text-blue-300", total: "bg-blue-50 dark:bg-blue-900/10 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-800/60", group: "text-blue-700 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10" },
    red:   { header: "bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800 text-red-800 dark:text-red-300",   total: "bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-400 border-red-100 dark:border-red-800/60",   group: "text-red-700 dark:text-red-400 bg-red-50/50 dark:bg-red-900/10" },
    green: { header: "bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800 text-green-800 dark:text-green-300", total: "bg-green-50 dark:bg-green-900/10 text-green-700 dark:text-green-400 border-green-100 dark:border-green-800/60", group: "text-green-700 dark:text-green-400 bg-green-50/50 dark:bg-green-900/10" },
  }
  const c = colors[accentColor]

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {section.groups.map((group, gi) => (
        <div key={group.key}>
          {/* Group header - only show if there are multiple groups or the group has a meaningful label */}
          {(section.groups.length > 1 || group.key !== section.key) && (
            <div className={`px-5 py-2.5 border-b text-xs font-semibold uppercase tracking-wide ${c.group}`}>
              {group.label}
            </div>
          )}
          <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {group.lines.map((line, i) => (
              <div key={line.account_id || `${group.key}-${i}`} className="flex items-center justify-between px-5 py-2.5 hover:bg-gray-50/60 dark:hover:bg-gray-700/20">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-mono text-gray-400 dark:text-gray-500 shrink-0 w-14">{line.account_code}</span>
                  <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{line.account_name}</span>
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-white shrink-0 ml-4">{formatCurrencySafe(line.amount)}</span>
              </div>
            ))}
          </div>
          {/* Group subtotal (only if multiple groups) */}
          {section.groups.length > 1 && (
            <div className={`flex items-center justify-between px-5 py-2.5 border-t text-sm font-semibold ${c.total}`}>
              <span>Total {group.label}</span>
              <span>{formatCurrencySafe(group.subtotal)}</span>
            </div>
          )}
          {gi < section.groups.length - 1 && <div className="border-t border-gray-100 dark:border-gray-700" />}
        </div>
      ))}
      {/* Section total */}
      <div className={`flex items-center justify-between px-5 py-3 border-t-2 border-gray-200 dark:border-gray-600 font-bold text-sm ${c.total}`}>
        <span>{totalLabel}</span>
        <span className="text-base">{formatCurrencySafe(section.subtotal)}</span>
      </div>
    </div>
  )
}

export default function BalanceSheetScreen({ mode, businessId }: ScreenProps) {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const noContext = !businessId
  const routeContextOk = !!businessId

  const [periods, setPeriods]                         = useState<AccountingPeriod[]>([])
  const [asOfDate, setAsOfDate]                       = useState(() => new Date().toISOString().split("T")[0])
  const [selectedPeriodStart, setSelectedPeriodStart] = useState<string | null>(null)
  const [includePeriodNetIncome, setIncludePeriodNetIncome] = useState(false)
  const [useDateRange, setUseDateRange]               = useState(false)
  const [rangeStartDate, setRangeStartDate]           = useState("")
  const [rangeEndDate, setRangeEndDate]               = useState("")

  const [assetSection, setAssetSection]       = useState<BSSection | null>(null)
  const [liabilitySection, setLiabilitySection] = useState<BSSection | null>(null)
  const [equitySection, setEquitySection]     = useState<BSSection | null>(null)
  const [totals, setTotals]                   = useState<Totals | null>(null)
  const [error, setError] = useState("")

  useEffect(() => { if (!businessId) setLoading(false) }, [businessId])
  useEffect(() => { if (businessId) loadPeriods() }, [businessId])

  useEffect(() => {
    if (selectedPeriodStart) {
      const period = periods.find((p) => p.period_start === selectedPeriodStart)
      if (period) setAsOfDate(period.period_end)
    }
  }, [selectedPeriodStart])

  useEffect(() => {
    if (businessId) {
      loadBalanceSheet()
    } else {
      setAssetSection(null)
      setLiabilitySection(null)
      setEquitySection(null)
      setTotals(null)
    }
  }, [
    businessId,
    asOfDate,
    selectedPeriodStart,
    includePeriodNetIncome,
    useDateRange,
    rangeStartDate,
    rangeEndDate,
  ])

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

  const parseSection = (raw: any): BSSection | null => {
    if (!raw) return null
    const groups: BSGroup[] = (raw.groups ?? []).map((g: any) => ({
      key:      g.key,
      label:    groupLabel(g.key),
      subtotal: g.subtotal ?? g.lines?.reduce((s: number, l: any) => s + (l.amount ?? 0), 0) ?? 0,
      lines:    (g.lines ?? []).map((l: any) => ({
        account_id:   l.account_id,
        account_code: l.account_code,
        account_name: l.account_name,
        amount:       l.amount,
      })),
    }))
    return { key: raw.key, groups, subtotal: raw.subtotal ?? 0 }
  }

  const loadBalanceSheet = async () => {
    if (!businessId) return
    if (useDateRange && (!rangeStartDate || !rangeEndDate)) {
      setAssetSection(null)
      setLiabilitySection(null)
      setEquitySection(null)
      setTotals(null)
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      setError("")
      let url = `/api/accounting/reports/balance-sheet?business_id=${businessId}`
      if (useDateRange && rangeStartDate && rangeEndDate) {
        url += `&start_date=${encodeURIComponent(rangeStartDate)}&end_date=${encodeURIComponent(rangeEndDate)}`
      } else {
        if (selectedPeriodStart) {
          url += `&period_start=${encodeURIComponent(selectedPeriodStart)}`
        } else if (asOfDate) {
          url += `&as_of_date=${encodeURIComponent(asOfDate)}`
        }
      }

      const response = await fetch(url)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load balance sheet")
      }
      const data = await response.json()
      const sections: any[] = data.sections ?? []

      setAssetSection(parseSection(sections.find((s) => s.key === "assets")))
      setLiabilitySection(parseSection(sections.find((s) => s.key === "liabilities")))
      setEquitySection(parseSection(sections.find((s) => s.key === "equity")))

      if (typeof data.as_of_date === "string" && data.as_of_date) {
        setAsOfDate(data.as_of_date)
      }

      if (data.totals) {
        setTotals({
          totalAssets:              data.totals.assets,
          totalLiabilities:         data.totals.liabilities,
          totalEquity:              data.totals.equity,
          adjustedEquity:           data.totals.liabilities_plus_equity - data.totals.liabilities,
          totalLiabilitiesAndEquity: data.totals.liabilities_plus_equity,
          balancingDifference:      data.totals.imbalance,
          isBalanced:               data.totals.is_balanced,
          currentPeriodNetIncome:   0,
        })
      } else {
        setTotals(null)
      }
    } catch (err: any) {
      setError(err.message || "Failed to load balance sheet")
    } finally {
      setLoading(false)
    }
  }

  const hasData = !!(assetSection || liabilitySection || equitySection)

  const handleExport = async (format: "csv" | "pdf") => {
    if (!businessId) {
      toast.showToast("Missing business context", "warning")
      return
    }
    if (useDateRange) {
      if (!rangeStartDate || !rangeEndDate) {
        toast.showToast("Please select start and end dates for the custom range", "warning")
        return
      }
    } else if (!asOfDate && !selectedPeriodStart) {
      toast.showToast("Please select a period or as-of date", "warning")
      return
    }
    const q = new URLSearchParams({ business_id: businessId })
    if (useDateRange && rangeStartDate && rangeEndDate) {
      q.set("start_date", rangeStartDate)
      q.set("end_date", rangeEndDate)
    } else {
      if (selectedPeriodStart) q.set("period_start", selectedPeriodStart)
      else if (asOfDate) q.set("as_of_date", asOfDate)
    }
    const url = `/api/accounting/reports/balance-sheet/export/${format}?${q.toString()}`
    const fallback = format === "pdf" ? "balance-sheet.pdf" : "balance-sheet.csv"
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

  const handlePrint = () => window.print()

  const formatPeriodOption = (p: AccountingPeriod) => {
    const d = new Date(p.period_start)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")} (${p.status})`
  }

  const backUrl = mode === "service" ? buildServiceRoute("/service/accounting", businessId) : "/accounting"

  if (!routeContextOk || noContext) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-6 text-amber-800 dark:text-amber-200">
            <p className="font-medium">No business context available.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 print:p-4">

        {/* Header */}
        <div className="mb-6 export-hide print:hidden">
          <button onClick={() => router.push(backUrl)} className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2 block">
            ← Back to Accounting
          </button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Balance Sheet</h1>
              {useDateRange && rangeStartDate && rangeEndDate ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Custom range {rangeStartDate} → {rangeEndDate}
                  {asOfDate ? (
                    <span className="text-gray-400"> · Statement as of {new Date(asOfDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
                  ) : null}
                </p>
              ) : asOfDate ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">As of {new Date(asOfDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
              ) : null}
            </div>
            <div className="flex gap-2 shrink-0">
              {hasData && (
                <>
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
                </>
              )}
              <button
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Print
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6 export-hide print:hidden">
          <div className="flex flex-wrap gap-3 gap-y-4 items-end">
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => {
                  setUseDateRange(false)
                  setRangeStartDate("")
                  setRangeEndDate("")
                  setError("")
                }}
                className={`px-3 py-1.5 font-medium transition-colors ${!useDateRange ? "bg-blue-600 text-white" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
              >
                Accounting Period
              </button>
              <button
                type="button"
                onClick={() => {
                  setUseDateRange(true)
                  setSelectedPeriodStart(null)
                  setIncludePeriodNetIncome(false)
                  setError("")
                }}
                className={`px-3 py-1.5 font-medium transition-colors ${useDateRange ? "bg-blue-600 text-white" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
              >
                Custom Range
              </button>
            </div>

            {!useDateRange ? (
              <>
                <div className="min-w-[160px]">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">As Of Date</label>
                  <input
                    type="date"
                    value={asOfDate}
                    onChange={(e) => { setAsOfDate(e.target.value); setError("") }}
                    disabled={!!selectedPeriodStart}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>
                <div className="min-w-[200px]">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    Jump to Period End
                  </label>
                  <select
                    value={selectedPeriodStart || ""}
                    onChange={(e) => { setSelectedPeriodStart(e.target.value || null); setError("") }}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— select period —</option>
                    {periods.map((p) => (
                      <option key={p.id} value={p.period_start}>{formatPeriodOption(p)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 pb-0.5">
                  <input
                    type="checkbox"
                    id="include-net-income"
                    checked={includePeriodNetIncome}
                    onChange={(e) => { setIncludePeriodNetIncome(e.target.checked); setError("") }}
                    disabled={!selectedPeriodStart}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-40"
                  />
                  <label htmlFor="include-net-income" className="text-sm text-gray-700 dark:text-gray-300">
                    Include period net income in equity
                  </label>
                  <span
                    title="Adds the period's net profit/loss into the equity section, giving you a provisionally closed balance sheet before the period is formally closed."
                    className="text-gray-400 hover:text-gray-600 cursor-help"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </span>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">From</label>
                  <input
                    type="date"
                    value={rangeStartDate}
                    onChange={(e) => { setRangeStartDate(e.target.value); setError("") }}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <span className="text-gray-400 text-sm pb-0.5">to</span>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">To</label>
                  <input
                    type="date"
                    value={rangeEndDate}
                    onChange={(e) => { setRangeEndDate(e.target.value); setError("") }}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs pb-0.5">
                  Resolves to the accounting period that contains the range start (same as Trial Balance). Statement date shown is that period&apos;s end.
                </p>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6 text-sm">
            {error}
          </div>
        )}

        {/* Balance status banners */}
        {totals && !totals.isBalanced && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl px-5 py-4 mb-6">
            <p className="font-semibold text-amber-900 dark:text-amber-200">⚠ Ledger not balanced</p>
            <p className="text-sm mt-1 text-amber-800 dark:text-amber-300">
              Difference: {formatCurrencySafe(Math.abs(totals.balancingDifference))}
              {totals.balancingDifference < 0 ? " — Liabilities + Equity exceed Assets" : " — Assets exceed Liabilities + Equity"}
            </p>
            <a href="/admin/accounting/forensic-runs" className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-amber-800 dark:text-amber-200 hover:underline">
              Investigate in forensic ledger →
            </a>
          </div>
        )}

        {totals?.isBalanced && hasData && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-xl px-5 py-3 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-semibold text-green-800 dark:text-green-200">Balanced</span>
              <span className="text-sm text-green-700 dark:text-green-300">
                Assets = Liabilities + Equity = {formatCurrencySafe(totals.totalAssets)}
              </span>
            </div>
            {asOfDate && (
              <span className="text-xs text-green-600 dark:text-green-400">
                As of {new Date(asOfDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            )}
          </div>
        )}

        {loading ? (
          <BSSkeleton />
        ) : hasData ? (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Assets column */}
              <div>
                {assetSection && (
                  <SectionPanel section={assetSection} accentColor="blue" totalLabel="Total Assets" />
                )}
              </div>

              {/* Liabilities + Equity column */}
              <div className="space-y-4">
                {liabilitySection && (
                  <SectionPanel section={liabilitySection} accentColor="red" totalLabel="Total Liabilities" />
                )}
                {equitySection && (
                  <>
                    <SectionPanel section={equitySection} accentColor="green" totalLabel="Total Equity" />
                    {/* Period net income row */}
                    {includePeriodNetIncome && totals && totals.currentPeriodNetIncome !== 0 && (
                      <div className="bg-white dark:bg-gray-800 rounded-xl border border-purple-200 dark:border-purple-700 px-5 py-3 flex items-center justify-between text-sm">
                        <span className="text-purple-800 dark:text-purple-300 font-medium">Period Net Income</span>
                        <span className="font-semibold text-purple-700 dark:text-purple-400">{formatCurrencySafe(totals.currentPeriodNetIncome)}</span>
                      </div>
                    )}
                  </>
                )}

                {/* Accounting equation summary */}
                {totals && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="px-5 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Summary</p>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
                      <div className="flex justify-between items-center px-5 py-2.5 text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Total Assets</span>
                        <span className="font-semibold text-blue-700 dark:text-blue-400">{formatCurrencySafe(totals.totalAssets)}</span>
                      </div>
                      <div className="flex justify-between items-center px-5 py-2.5 text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Total Liabilities</span>
                        <span className="font-semibold text-red-700 dark:text-red-400">{formatCurrencySafe(totals.totalLiabilities)}</span>
                      </div>
                      <div className="flex justify-between items-center px-5 py-2.5 text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Total Equity</span>
                        <span className="font-semibold text-green-700 dark:text-green-400">{formatCurrencySafe(totals.adjustedEquity || totals.totalEquity)}</span>
                      </div>
                      <div className="flex justify-between items-center px-5 py-3 text-sm font-bold">
                        <span className="text-gray-900 dark:text-white">Liabilities + Equity</span>
                        <span className={totals.isBalanced ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                          {formatCurrencySafe(totals.totalLiabilitiesAndEquity)}
                          {totals.isBalanced ? " ✓" : " ✗"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : asOfDate ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">No balance sheet accounts with balances found as of {asOfDate}.</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
