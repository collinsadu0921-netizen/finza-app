"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { formatCurrencySafe } from "@/lib/currency/formatCurrency"
import { buildServiceRoute } from "@/lib/service/routes"
import type { ScreenProps } from "./types"

// ─── Local types ──────────────────────────────────────────────────────────────

type AccountingPeriod = {
  id: string
  period_start: string
  period_end: string
  status: "open" | "soft_closed" | "locked"
}

type EquityChangesRow = {
  label: string
  share_capital: number
  retained_earnings: number
  other_equity: number
  total: number
  row_type: "opening" | "profit" | "movement" | "closing" | "account_detail"
  account_code?: string
}

type Totals = {
  opening: number
  net_profit: number
  period_movements: number
  closing: number
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ECSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-64 bg-gray-100 dark:bg-gray-800 rounded-xl" />
      <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl" />
    </div>
  )
}

// ─── Amount cell ──────────────────────────────────────────────────────────────

function AmountCell({ amount, bold = false }: { amount: number; bold?: boolean }) {
  const zero = amount === 0
  const neg  = amount < 0
  return (
    <td
      className={`px-4 py-2.5 text-right text-sm tabular-nums ${
        bold ? "font-bold" : "font-medium"
      } ${
        zero ? "text-gray-300 dark:text-gray-600"
        : neg  ? "text-red-600 dark:text-red-400"
               : "text-gray-900 dark:text-white"
      }`}
    >
      {zero
        ? "—"
        : neg
          ? `(${formatCurrencySafe(Math.abs(amount))})`
          : formatCurrencySafe(amount)}
    </td>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function EquityChangesScreen({ mode, businessId }: ScreenProps) {
  const router     = useRouter()
  const noContext  = !businessId
  const routeOk   = !!businessId

  const [periods, setPeriods]                         = useState<AccountingPeriod[]>([])
  const [selectedPeriodStart, setSelectedPeriodStart] = useState<string | null>(null)

  const [tableRows, setTableRows]       = useState<EquityChangesRow[]>([])
  const [totals, setTotals]             = useState<Totals | null>(null)
  const [note, setNote]                 = useState("")
  const [periodInfo, setPeriodInfo]     = useState<{ period_start: string; period_end: string } | null>(null)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState("")

  useEffect(() => { if (!businessId) setLoading(false) }, [businessId])
  useEffect(() => { if (businessId)  loadPeriods() },     [businessId])
  useEffect(() => {
    if (businessId) loadEquityChanges()
    else { setTableRows([]); setTotals(null) }
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

  const loadEquityChanges = async () => {
    if (!businessId) return
    try {
      setLoading(true)
      setError("")
      let url = `/api/accounting/reports/equity-changes?business_id=${businessId}`
      if (selectedPeriodStart) url += `&period_start=${selectedPeriodStart}`

      const res = await fetch(url)
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Failed to load equity changes")
      }
      const data = await res.json()

      setTableRows(data.rows ?? [])
      setTotals(data.totals ?? null)
      setNote(data.note ?? "")
      setPeriodInfo(data.period ?? null)
    } catch (err: any) {
      setError(err.message ?? "Failed to load equity changes")
    } finally {
      setLoading(false)
    }
  }

  const formatPeriodOption = (p: AccountingPeriod) => {
    const d = new Date(p.period_start)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")} (${p.status})`
  }

  const backUrl = mode === "service"
    ? buildServiceRoute("/service/accounting", businessId)
    : "/accounting"

  const hasData = tableRows.length > 0

  if (!routeOk || noContext) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-6 text-amber-800 dark:text-amber-200">
            <p className="font-medium">No business context available.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 print:p-4">

        {/* Header */}
        <div className="mb-6 export-hide print:hidden">
          <button onClick={() => router.push(backUrl)} className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2 block">
            ← Back to Accounting
          </button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Statement of Changes in Equity</h1>
              {periodInfo && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  For the period{" "}
                  {new Date(periodInfo.period_start).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                  {" "}to{" "}
                  {new Date(periodInfo.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">IAS 1 §106</p>
            </div>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print
            </button>
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
          <ECSkeleton />
        ) : hasData ? (
          <div className="space-y-4">

            {/* Equity changes table — IAS 1 columnar format */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-1/2">
                        Description
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Share Capital
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Retained Earnings
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Other Reserves
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                    {tableRows.map((row, i) => {
                      const isOpenClose = row.row_type === "opening" || row.row_type === "closing"
                      const isProfit    = row.row_type === "profit"

                      return (
                        <tr
                          key={i}
                          className={
                            isOpenClose
                              ? "bg-gray-50 dark:bg-gray-700/30"
                              : isProfit
                                ? "bg-blue-50/40 dark:bg-blue-900/10"
                                : "hover:bg-gray-50/60 dark:hover:bg-gray-700/20"
                          }
                        >
                          <td className={`px-5 py-2.5 ${isOpenClose ? "font-bold text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"}`}>
                            <div className="flex items-center gap-2">
                              {row.account_code && (
                                <span className="text-xs font-mono text-gray-400 dark:text-gray-500 w-12 shrink-0">
                                  {row.account_code}
                                </span>
                              )}
                              <span className={row.row_type === "movement" ? "pl-4" : ""}>
                                {row.label}
                              </span>
                            </div>
                          </td>
                          <AmountCell amount={row.share_capital}     bold={isOpenClose} />
                          <AmountCell amount={row.retained_earnings} bold={isOpenClose} />
                          <AmountCell amount={row.other_equity}      bold={isOpenClose} />
                          <AmountCell amount={row.total}             bold={isOpenClose || isProfit} />
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary panel */}
            {totals && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Equity Summary</p>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
                  <div className="flex justify-between items-center px-5 py-2.5 text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Opening equity</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{formatCurrencySafe(totals.opening)}</span>
                  </div>
                  <div className="flex justify-between items-center px-5 py-2.5 text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Profit for the period</span>
                    <span className={`font-semibold ${totals.net_profit < 0 ? "text-red-600 dark:text-red-400" : "text-blue-700 dark:text-blue-400"}`}>
                      {totals.net_profit < 0
                        ? `(${formatCurrencySafe(Math.abs(totals.net_profit))})`
                        : formatCurrencySafe(totals.net_profit)}
                    </span>
                  </div>
                  {totals.period_movements !== 0 && (
                    <div className="flex justify-between items-center px-5 py-2.5 text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Other movements (dividends, issuances)</span>
                      <span className={`font-semibold ${totals.period_movements < 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                        {totals.period_movements < 0
                          ? `(${formatCurrencySafe(Math.abs(totals.period_movements))})`
                          : formatCurrencySafe(totals.period_movements)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center px-5 py-3 font-bold text-sm">
                    <span className="text-gray-900 dark:text-white">Closing equity</span>
                    <span className="text-base text-gray-900 dark:text-white">{formatCurrencySafe(totals.closing)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* IAS 1 note */}
            {note && (
              <p className="text-xs text-gray-400 dark:text-gray-500 px-1">
                ℹ {note}
              </p>
            )}

          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">No equity account activity found for the selected period.</p>
          </div>
        )}
      </div>
    </div>
  )
}
