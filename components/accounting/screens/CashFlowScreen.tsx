"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
import { formatCurrencySafe } from "@/lib/currency/formatCurrency"
import { buildServiceRoute } from "@/lib/service/routes"
import type { ScreenProps } from "./types"

// ─── Local types (mirrors API response) ─────────────────────────────────────

type AccountingPeriod = {
  id: string
  period_start: string
  period_end: string
  status: "open" | "soft_closed" | "locked"
}

type CashFlowLine = {
  account_id?: string
  account_code: string
  account_name: string
  amount: number
  is_adjustment?: boolean
}

type CashFlowSection = {
  key: string
  label: string
  lines: CashFlowLine[]
  adjustments: CashFlowLine[]
  net: number
}

type CashReconciliation = {
  opening_cash: number
  net_cash_movement: number
  closing_cash_ledger: number
  closing_cash_computed: number
  reconciles: boolean
  difference: number
}

type Totals = {
  net_operating: number
  net_investing: number
  net_financing: number
  net_change_in_cash: number
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function CashFlowSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-48 bg-gray-100 dark:bg-gray-800 rounded-xl" />
      ))}
      <div className="h-28 bg-gray-100 dark:bg-gray-800 rounded-xl" />
    </div>
  )
}

// ─── Section panel ────────────────────────────────────────────────────────────

const SECTION_COLORS = {
  operating: {
    header: "bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 border-blue-100 dark:border-blue-800",
    net:     "bg-blue-50 dark:bg-blue-900/10 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-800/60",
  },
  investing: {
    header: "bg-purple-50 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300 border-purple-100 dark:border-purple-800",
    net:     "bg-purple-50 dark:bg-purple-900/10 text-purple-700 dark:text-purple-400 border-purple-100 dark:border-purple-800/60",
  },
  financing: {
    header: "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border-green-100 dark:border-green-800",
    net:     "bg-green-50 dark:bg-green-900/10 text-green-700 dark:text-green-400 border-green-100 dark:border-green-800/60",
  },
}

function SectionPanel({ section }: { section: CashFlowSection }) {
  const c = SECTION_COLORS[section.key as keyof typeof SECTION_COLORS] ?? SECTION_COLORS.financing
  const allLines = [...section.lines, ...section.adjustments]

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Section header */}
      <div className={`px-5 py-3 border-b font-semibold text-sm uppercase tracking-wide ${c.header}`}>
        {section.label}
      </div>

      {allLines.length === 0 ? (
        <div className="px-5 py-4 text-sm text-gray-400 dark:text-gray-500 italic">
          No activity this period.
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {allLines.map((line, i) => {
            const isNegative = line.amount < 0
            return (
              <div
                key={`${line.account_code}-${i}`}
                className={`flex items-center justify-between px-5 py-2.5 hover:bg-gray-50/60 dark:hover:bg-gray-700/20 ${
                  line.is_adjustment ? "pl-9" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {line.account_code && (
                    <span className="text-xs font-mono text-gray-400 dark:text-gray-500 shrink-0 w-14">
                      {line.account_code}
                    </span>
                  )}
                  <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                    {line.account_name}
                  </span>
                </div>
                <span
                  className={`text-sm font-medium shrink-0 ml-4 ${
                    isNegative
                      ? "text-red-600 dark:text-red-400"
                      : "text-gray-900 dark:text-white"
                  }`}
                >
                  {isNegative
                    ? `(${formatCurrencySafe(Math.abs(line.amount))})`
                    : formatCurrencySafe(line.amount)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Net for section */}
      <div
        className={`flex items-center justify-between px-5 py-3 border-t-2 border-gray-200 dark:border-gray-600 font-bold text-sm ${c.net}`}
      >
        <span>Net cash {section.key === "operating" ? "from" : section.net < 0 ? "used in" : "from"} {section.label.toLowerCase()}</span>
        <span className={`text-base ${section.net < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
          {section.net < 0
            ? `(${formatCurrencySafe(Math.abs(section.net))})`
            : formatCurrencySafe(section.net)}
        </span>
      </div>
    </div>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CashFlowScreen({ mode, businessId }: ScreenProps) {
  const router = useRouter()
  const toast  = useToast()
  const noContext    = !businessId
  const routeContextOk = !!businessId

  const [periods, setPeriods]                         = useState<AccountingPeriod[]>([])
  const [selectedPeriodStart, setSelectedPeriodStart] = useState<string | null>(null)

  const [sections, setSections]                   = useState<CashFlowSection[]>([])
  const [reconciliation, setReconciliation]       = useState<CashReconciliation | null>(null)
  const [totals, setTotals]                       = useState<Totals | null>(null)
  const [periodInfo, setPeriodInfo]               = useState<{ period_start: string; period_end: string } | null>(null)
  const [loading, setLoading]                     = useState(true)
  const [error, setError]                         = useState("")

  useEffect(() => { if (!businessId) setLoading(false) }, [businessId])
  useEffect(() => { if (businessId)  loadPeriods() },     [businessId])
  useEffect(() => {
    if (businessId) loadCashFlow()
    else { setSections([]); setReconciliation(null); setTotals(null) }
  }, [businessId, selectedPeriodStart])

  const loadPeriods = async () => {
    if (!businessId) return
    try {
      const res = await fetch(`/api/accounting/periods?business_id=${businessId}`)
      if (!res.ok) return
      const d = await res.json()
      setPeriods(d.periods ?? [])
    } catch {}
  }

  const loadCashFlow = async () => {
    if (!businessId) return
    try {
      setLoading(true)
      setError("")
      let url = `/api/accounting/reports/cash-flow?business_id=${businessId}`
      if (selectedPeriodStart) url += `&period_start=${selectedPeriodStart}`

      const res = await fetch(url)
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Failed to load cash flow statement")
      }
      const data = await res.json()

      setSections(data.sections ?? [])
      setReconciliation(data.cash_reconciliation ?? null)
      setTotals(data.totals ?? null)
      setPeriodInfo(data.period ?? null)
    } catch (err: any) {
      setError(err.message ?? "Failed to load cash flow statement")
    } finally {
      setLoading(false)
    }
  }

  const handleExport = (format: "csv") => {
    if (!businessId) { toast.showToast("No business selected", "warning"); return }
    let url = `/api/accounting/reports/cash-flow/export/${format}?business_id=${businessId}`
    if (selectedPeriodStart) url += `&period_start=${selectedPeriodStart}`
    window.open(url, "_blank")
  }

  const formatPeriodOption = (p: AccountingPeriod) => {
    const d = new Date(p.period_start)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")} (${p.status})`
  }

  const backUrl = mode === "service"
    ? buildServiceRoute("/service/accounting", businessId)
    : "/accounting"

  const hasData = sections.length > 0

  if (!routeContextOk || noContext) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-6 text-amber-800 dark:text-amber-200">
            <p className="font-medium">No business context available.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 print:p-4">

        {/* Header */}
        <div className="mb-6 export-hide print:hidden">
          <button onClick={() => router.push(backUrl)} className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2 block">
            ← Back to Accounting
          </button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Statement of Cash Flows</h1>
              {periodInfo && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  For the period {new Date(periodInfo.period_start).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                  {" "}to{" "}
                  {new Date(periodInfo.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">IAS 7 — Indirect Method</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => window.print()}
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

        {/* Period filter */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6 export-hide print:hidden">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="min-w-[220px]">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Accounting Period
              </label>
              <select
                value={selectedPeriodStart ?? ""}
                onChange={(e) => { setSelectedPeriodStart(e.target.value || null); setError("") }}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— latest period —</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.period_start}>{formatPeriodOption(p)}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <CashFlowSkeleton />
        ) : hasData ? (
          <div className="space-y-4">

            {/* Three sections */}
            {sections.map((section) => (
              <SectionPanel key={section.key} section={section} />
            ))}

            {/* Net change in cash */}
            {totals && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Cash Summary</p>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
                  <div className="flex justify-between items-center px-5 py-2.5 text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Net cash from operating activities</span>
                    <span className={`font-semibold ${totals.net_operating < 0 ? "text-red-600 dark:text-red-400" : "text-blue-700 dark:text-blue-400"}`}>
                      {totals.net_operating < 0
                        ? `(${formatCurrencySafe(Math.abs(totals.net_operating))})`
                        : formatCurrencySafe(totals.net_operating)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center px-5 py-2.5 text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Net cash from investing activities</span>
                    <span className={`font-semibold ${totals.net_investing < 0 ? "text-red-600 dark:text-red-400" : "text-purple-700 dark:text-purple-400"}`}>
                      {totals.net_investing < 0
                        ? `(${formatCurrencySafe(Math.abs(totals.net_investing))})`
                        : formatCurrencySafe(totals.net_investing)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center px-5 py-2.5 text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Net cash from financing activities</span>
                    <span className={`font-semibold ${totals.net_financing < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
                      {totals.net_financing < 0
                        ? `(${formatCurrencySafe(Math.abs(totals.net_financing))})`
                        : formatCurrencySafe(totals.net_financing)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center px-5 py-3 font-bold text-sm">
                    <span className="text-gray-900 dark:text-white">Net increase/(decrease) in cash</span>
                    <span className={`text-base ${totals.net_change_in_cash < 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                      {totals.net_change_in_cash < 0
                        ? `(${formatCurrencySafe(Math.abs(totals.net_change_in_cash))})`
                        : formatCurrencySafe(totals.net_change_in_cash)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Cash reconciliation */}
            {reconciliation && (
              <div className={`bg-white dark:bg-gray-800 rounded-xl border overflow-hidden ${
                reconciliation.reconciles
                  ? "border-green-200 dark:border-green-800"
                  : "border-amber-200 dark:border-amber-800"
              }`}>
                <div className={`px-5 py-3 border-b flex items-center justify-between ${
                  reconciliation.reconciles
                    ? "bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800"
                    : "bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800"
                }`}>
                  <p className={`text-xs font-semibold uppercase tracking-wide ${
                    reconciliation.reconciles
                      ? "text-green-700 dark:text-green-400"
                      : "text-amber-700 dark:text-amber-400"
                  }`}>
                    Cash Reconciliation
                  </p>
                  {reconciliation.reconciles ? (
                    <span className="text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Reconciles
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                      ⚠ Difference: {formatCurrencySafe(Math.abs(reconciliation.difference))}
                    </span>
                  )}
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
                  <div className="flex justify-between items-center px-5 py-2.5 text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Opening cash and cash equivalents</span>
                    <span className="font-medium text-gray-900 dark:text-white">{formatCurrencySafe(reconciliation.opening_cash)}</span>
                  </div>
                  <div className="flex justify-between items-center px-5 py-2.5 text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Net movement in cash</span>
                    <span className={`font-medium ${reconciliation.net_cash_movement < 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                      {reconciliation.net_cash_movement < 0
                        ? `(${formatCurrencySafe(Math.abs(reconciliation.net_cash_movement))})`
                        : formatCurrencySafe(reconciliation.net_cash_movement)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center px-5 py-3 font-bold text-sm">
                    <span className="text-gray-900 dark:text-white">Closing cash and cash equivalents</span>
                    <span className="text-base text-gray-900 dark:text-white">{formatCurrencySafe(reconciliation.closing_cash_ledger)}</span>
                  </div>
                </div>
              </div>
            )}

          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">No journal activity found for the selected period.</p>
          </div>
        )}
      </div>
    </div>
  )
}
