"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { getCurrentBusiness, getSelectedBusinessId } from "@/lib/business"
import { supabase } from "@/lib/supabaseClient"
import { retailPaths } from "@/lib/retail/routes"

type VatControlReport = {
  opening_balance: number
  vat_collected: number
  vat_reversed: number
  closing_balance: number
  period_id: string | null
  period: {
    start_date: string
    end_date: string
  }
  account: {
    id: string
    code: string
    name: string
  }
  invariant_valid: boolean
  invariant_check: {
    formula: string
    calculated: number
    actual: number
    difference: number
  }
}

function preset(label: string, start: string, end: string) {
  return { label, start, end }
}

function getPeriodPresets() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()

  const thisMonthStart = new Date(y, m, 1).toISOString().split("T")[0]
  const thisMonthEnd   = new Date(y, m + 1, 0).toISOString().split("T")[0]

  const lastMonthStart = new Date(y, m - 1, 1).toISOString().split("T")[0]
  const lastMonthEnd   = new Date(y, m, 0).toISOString().split("T")[0]

  const qStart = new Date(y, Math.floor(m / 3) * 3, 1).toISOString().split("T")[0]
  const qEnd   = new Date(y, Math.floor(m / 3) * 3 + 3, 0).toISOString().split("T")[0]

  return [
    preset("This Month", thisMonthStart, thisMonthEnd),
    preset("Last Month", lastMonthStart, lastMonthEnd),
    preset("This Quarter", qStart, qEnd),
  ]
}

export default function VatControlReportPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isRetailContext = Boolean(pathname?.startsWith("/retail/"))
  const businessIdFromUrl =
    searchParams.get("business_id") ?? searchParams.get("businessId") ?? null
  const [businessId, setBusinessId] = useState<string | null>(businessIdFromUrl)
  /** False until we have finished URL → localStorage → getCurrentBusiness resolution (avoids a false "no business" flash). */
  const [businessContextReady, setBusinessContextReady] = useState(!!businessIdFromUrl)
  const { format } = useBusinessCurrency()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reportData, setReportData] = useState<VatControlReport | null>(null)

  useEffect(() => {
    let cancelled = false

    if (businessIdFromUrl) {
      setBusinessId(businessIdFromUrl)
      setBusinessContextReady(true)
      return () => {
        cancelled = true
      }
    }

    setBusinessContextReady(false)
    ;(async () => {
      const fromStorage = getSelectedBusinessId()
      if (fromStorage) {
        if (!cancelled) {
          setBusinessId(fromStorage)
          setBusinessContextReady(true)
        }
        return
      }
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) {
        if (!cancelled) {
          setBusinessId(null)
          setBusinessContextReady(true)
        }
        return
      }
      const business = await getCurrentBusiness(supabase, user.id)
      if (!cancelled) {
        setBusinessId(business?.id ?? null)
        setBusinessContextReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [businessIdFromUrl])

  const now = new Date()
  const [startDate, setStartDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]
  )
  const [endDate, setEndDate] = useState(
    new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0]
  )

  const presets = getPeriodPresets()

  useEffect(() => {
    if (!businessContextReady) return
    loadReport()
  }, [startDate, endDate, businessId, businessContextReady])

  const loadReport = async () => {
    try {
      setLoading(true)
      setError("")

      if (!startDate || !endDate) {
        setError("Please select both start and end dates")
        setLoading(false)
        return
      }

      if (!businessId) {
        setError(
          "No business could be resolved for this report. Choose your business in workspace settings, or open the VAT report from a link that includes your business."
        )
        setLoading(false)
        return
      }

      const params = new URLSearchParams({ start_date: startDate, end_date: endDate })
      params.set("business_id", businessId)
      const response = await fetch(`/api/reports/vat-control?${params.toString()}`)

      if (!response.ok) {
        const errorData = await response.json()
        setError(
          errorData.message ||
            errorData.error ||
            "Failed to load VAT Control Report"
        )
        setReportData(null)
        setLoading(false)
        return
      }

      const data = await response.json()
      setReportData(data)
    } catch (err: any) {
      setError(err.message || "Failed to load VAT Control Report")
      setReportData(null)
    } finally {
      setLoading(false)
    }
  }

  const applyPreset = (p: { start: string; end: string }) => {
    setStartDate(p.start)
    setEndDate(p.end)
  }

  const isActivePreset = (p: { start: string; end: string }) =>
    startDate === p.start && endDate === p.end

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950 pb-12 font-sans">
        <div className="max-w-3xl mx-auto px-4 py-6">

          {/* Back + title */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  isRetailContext ? router.push(retailPaths.dashboard) : router.back()
                }
                className="group flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <svg
                  className="w-4 h-4 transition-transform group-hover:-translate-x-0.5"
                  fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                {isRetailContext ? "Retail home" : "Reports"}
              </button>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <span className="font-mono text-xs tracking-widest text-slate-400 uppercase">
                VAT Control
              </span>
            </div>

            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors print:hidden"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z" />
              </svg>
              Print
            </button>
          </div>

          {/* Filter card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-gray-700 px-5 py-4 mb-4 print:hidden">
            {/* Presets */}
            <div className="flex gap-2 mb-3 flex-wrap">
              {presets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    isActivePreset(p)
                      ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900 border-transparent"
                      : "text-slate-600 dark:text-slate-400 border-slate-200 dark:border-gray-600 hover:bg-slate-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
              <button
                onClick={loadReport}
                className="px-4 py-2 text-sm bg-slate-800 dark:bg-white text-white dark:text-slate-900 rounded-md hover:bg-slate-700 dark:hover:bg-slate-100 transition-colors"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm mb-4">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-gray-700 px-6 py-12 flex flex-col items-center gap-3">
              <svg className="w-6 h-6 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <p className="text-sm text-slate-400">Loading VAT Control Report…</p>
            </div>
          )}

          {/* Report */}
          {!loading && reportData && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-gray-700 overflow-hidden">

              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-700">
                <h1 className="text-lg font-semibold text-slate-800 dark:text-white tracking-tight">
                  VAT control (ledger)
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  {reportData.account.code} — {reportData.account.name}
                  &ensp;·&ensp;
                  {reportData.period.start_date} to {reportData.period.end_date}
                  {isRetailContext ? (
                    <> · Totals follow posted journal entry dates (not POS receipt time).</>
                  ) : null}
                </p>
              </div>

              {/* Stat grid */}
              <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 dark:divide-gray-700 border-b border-slate-100 dark:border-gray-700">
                {[
                  {
                    label: "Opening Balance",
                    value: format(reportData.opening_balance),
                    sub: `Before ${reportData.period.start_date}`,
                    color: "text-slate-800 dark:text-white",
                  },
                  {
                    label: "VAT Collected",
                    value: format(reportData.vat_collected),
                    sub: "Credits — liability increases",
                    color: "text-emerald-600 dark:text-emerald-400",
                  },
                  {
                    label: "VAT Reversed",
                    value: format(reportData.vat_reversed),
                    sub: "Debits — liability decreases",
                    color: "text-red-600 dark:text-red-400",
                  },
                  {
                    label: "Closing Balance",
                    value: format(reportData.closing_balance),
                    sub: `After ${reportData.period.end_date}`,
                    color: "text-indigo-600 dark:text-indigo-400",
                  },
                ].map(({ label, value, sub, color }) => (
                  <div key={label} className="px-6 py-5">
                    <p className="text-xs text-slate-400 mb-1">{label}</p>
                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                    <p className="text-xs text-slate-400 mt-1">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Invariant Check */}
              <div className="px-6 py-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Invariant Check</p>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      reportData.invariant_valid
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                        : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                    }`}
                  >
                    {reportData.invariant_valid ? "✓ Valid" : "✗ Invalid"}
                  </span>
                </div>

                <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1.5">
                  <div>
                    <span className="font-medium text-slate-700 dark:text-slate-300">Formula: </span>
                    {reportData.invariant_check.formula}
                  </div>
                  <div>
                    <span className="font-medium text-slate-700 dark:text-slate-300">Calculation: </span>
                    {format(reportData.opening_balance)} + {format(reportData.vat_collected)} − {format(reportData.vat_reversed)} = {format(reportData.invariant_check.calculated)}
                  </div>
                  <div>
                    <span className="font-medium text-slate-700 dark:text-slate-300">Actual Closing Balance: </span>
                    {format(reportData.invariant_check.actual)}
                  </div>
                  {reportData.invariant_check.difference > 0.01 && (
                    <div className="text-red-600 dark:text-red-400 font-medium">
                      Difference: {format(reportData.invariant_check.difference)}
                    </div>
                  )}
                </div>
              </div>

              {/* Ledger note */}
              <div className="px-6 py-3 bg-slate-50 dark:bg-gray-800/60 border-t border-slate-100 dark:border-gray-700">
                <p className="text-xs text-slate-400">
                  Data sourced exclusively from{" "}
                  <code className="font-mono bg-slate-100 dark:bg-gray-700 px-1 rounded">journal_entry_lines</code>{" "}
                  on account{" "}
                  <code className="font-mono bg-slate-100 dark:bg-gray-700 px-1 rounded">2100</code>.
                  All figures are ledger-only.
                </p>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && !reportData && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-gray-700 px-6 py-12 text-center">
              <p className="text-sm text-slate-400">No data available for the selected period.</p>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
