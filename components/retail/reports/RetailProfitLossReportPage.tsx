"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { retailPaths, retailReportApi } from "@/lib/retail/routes"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { retailLedgerReportErrorMessage } from "@/lib/retail/reportClientErrors"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import {
  RetailBackofficeAlert,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeCardTitle,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeSkeleton,
  retailFieldClass,
  retailLabelClass,
  RetailMenuSelect,
  type MenuSelectOption,
} from "@/components/retail/RetailBackofficeUi"

const PL_PERIOD_RANGE_OPTIONS: MenuSelectOption[] = [
  { value: "thisMonth", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "custom", label: "Custom" },
]

/** P&L payload from `/api/retail/reports/profit-and-loss` (same ledger shape as the canonical engine). */
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
  totals: {
    gross_profit: number
    operating_profit: number
    profit_before_tax?: number
    net_profit: number
  }
  telemetry: {
    resolved_period_reason: string
    resolved_period_start: string
    resolved_period_end: string
    source: string
    version: number
  }
}

export default function RetailProfitLossReportPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [data, setData] = useState<ProfitLossData | null>(null)
  const [dateRange, setDateRange] = useState<"thisMonth" | "lastMonth" | "custom">("thisMonth")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [business, setBusiness] = useState<any>(null)

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
        setError("Sign in to view this report.")
        setLoading(false)
        return
      }

      const currentBusiness = await getCurrentBusiness(supabase, user.id)
      if (!currentBusiness) {
        setError("No store was found for your account.")
        setBusiness(null)
        setLoading(false)
        return
      }
      setBusiness(currentBusiness)

      const params = new URLSearchParams()
      if (dateRange === "custom" && startDate) {
        params.set("start_date", startDate)
        if (endDate) params.set("end_date", endDate)
      } else if (dateRange === "lastMonth") {
        params.set("period_start", new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().split("T")[0])
      }
      // thisMonth or no selection: no period params — server resolves (latest_activity / current_month_fallback)

      const response = await fetch(`${retailReportApi.profitAndLoss}?${params.toString()}`)

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as Record<string, unknown>
        setError(retailLedgerReportErrorMessage(response.status, errBody))
        setData(null)
        setLoading(false)
        return
      }

      const raw = await response.json()
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
  const subtotal = (key: string) =>
    data ? Math.round((data.sections.find((s) => s.key === key)?.subtotal ?? 0) * 100) / 100 : 0

  const revenueTotal = data
    ? data.sections.filter((s) => s.key === "income" || s.key === "other_income").reduce((sum, s) => sum + s.subtotal, 0)
    : 0
  const cogsTotal = subtotal("cogs")
  const operatingAndOtherExpensesTotal =
    data != null
      ? Math.round(
          (subtotal("operating_expenses") + subtotal("other_expenses") + subtotal("taxes")) * 100,
        ) / 100
      : 0

  if (loading) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-7xl">
          <RetailBackofficePageHeader
            eyebrow="Reports"
            title="Profit & loss"
            description="Pulling posted sales, COGS, and expenses from your store books."
          />
          <RetailBackofficeSkeleton rows={10} />
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-7xl">
        {!business?.default_currency ? (
          <RetailBackofficeAlert tone="warning" className="mb-4">
            <p className="font-medium">Set your store currency</p>
            <p className="mt-1 text-sm opacity-90">
              Add a default currency in Business profile so amounts display consistently.
            </p>
            <RetailBackofficeButton variant="secondary" className="mt-3" onClick={() => router.push(retailPaths.settingsBusinessProfile)}>
              Open business profile
            </RetailBackofficeButton>
          </RetailBackofficeAlert>
        ) : null}

        <RetailBackofficeAlert tone="info" className="mb-6">
          Read-only snapshot from your posted ledger. Revenue, cost of goods sold, and operating costs stay separate so
          margin matches how retail sales post. Export is not available on this retail view.
        </RetailBackofficeAlert>

        <RetailBackofficePageHeader
          eyebrow="Reports"
          title="Profit & loss"
          description="Owner-friendly view of how the period performed — totals first, then account detail."
          actions={
            business?.default_currency ? (
              <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                {business.default_currency}
              </span>
            ) : null
          }
        />

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-6">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        <RetailBackofficeCard className="mb-8">
          <RetailBackofficeCardTitle className="mb-4">Period</RetailBackofficeCardTitle>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className={retailLabelClass}>Range</label>
              <RetailMenuSelect
                value={dateRange}
                onValueChange={(v) => setDateRange(v as "thisMonth" | "lastMonth" | "custom")}
                options={PL_PERIOD_RANGE_OPTIONS}
              />
            </div>
            {dateRange === "custom" && (
              <>
                <div>
                  <label className={retailLabelClass}>Start</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={retailFieldClass} />
                </div>
                <div>
                  <label className={retailLabelClass}>End</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={retailFieldClass} />
                </div>
              </>
            )}
          </div>
          {data ? (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-600">
                Showing <span className="font-medium text-slate-900">{formatPeriod()}</span>
                {data.telemetry?.resolved_period_reason ? (
                  <span className="ml-2 text-xs text-slate-500">({data.telemetry.resolved_period_reason})</span>
                ) : null}
              </p>
            </div>
          ) : null}
        </RetailBackofficeCard>

        {data ? (
          <>
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <RetailBackofficeCard padding="p-4 sm:p-5" className="border-emerald-200/60 bg-emerald-50/20">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-900/80">Revenue</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{formatCurrency(revenueTotal)}</p>
                <p className="mt-2 text-xs text-slate-600">
                  Gross after COGS: <span className="font-medium text-slate-800">{formatCurrency(data.totals.gross_profit)}</span>
                </p>
              </RetailBackofficeCard>
              <RetailBackofficeCard padding="p-4 sm:p-5" className="border-amber-200/70 bg-amber-50/25">
                <p className="text-xs font-medium uppercase tracking-wide text-amber-950/80">Cost of goods sold</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{formatCurrency(cogsTotal)}</p>
                <p className="mt-2 text-xs text-slate-600">Posted from retail sales (ledger 5000–5999).</p>
              </RetailBackofficeCard>
              <RetailBackofficeCard padding="p-4 sm:p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Operating &amp; other</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {formatCurrency(operatingAndOtherExpensesTotal)}
                </p>
                <p className="mt-2 text-xs text-slate-600">Operating, other, and taxes — excludes COGS.</p>
              </RetailBackofficeCard>
              <RetailBackofficeCard
                padding="p-4 sm:p-5"
                className={
                  data.totals.net_profit >= 0
                    ? "border-slate-200 bg-slate-50/40"
                    : "border-amber-200/80 bg-amber-50/35"
                }
              >
                <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
                  Net {data.totals.net_profit >= 0 ? "profit" : "loss"}
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {formatCurrency(data.totals.net_profit)}
                </p>
                <p className="mt-2 text-xs text-slate-600">
                  Net margin:{" "}
                  <span className="font-medium text-slate-800">
                    {revenueTotal > 0 ? ((data.totals.net_profit / revenueTotal) * 100).toFixed(2) : "0.00"}%
                  </span>
                </p>
              </RetailBackofficeCard>
            </div>

            {data.sections.map((section) =>
              (section.lines.length > 0 || section.subtotal !== 0) ? (
                <RetailBackofficeCard key={section.key} padding="p-0" className="mb-6 overflow-hidden">
                  <div className="border-b border-slate-100 bg-slate-50/90 px-5 py-3 sm:px-6">
                    <h2 className="text-sm font-semibold tracking-tight text-slate-900">{section.label}</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px]">
                      <thead className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 backdrop-blur-sm">
                        <tr>
                          <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                            Code
                          </th>
                          <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                            Account
                          </th>
                          <th className="px-5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {section.lines.length > 0 ? (
                          section.lines.map((line, idx) => (
                            <tr key={`${section.key}-${idx}`} className="hover:bg-slate-50/80">
                              <td className="whitespace-nowrap px-5 py-3 font-mono text-sm text-slate-600 sm:px-6">{line.account_code}</td>
                              <td className="px-5 py-3 text-sm text-slate-900 sm:px-6">{line.account_name}</td>
                              <td className="whitespace-nowrap px-5 py-3 text-right text-sm font-medium tabular-nums text-slate-900 sm:px-6">
                                {formatCurrency(line.amount)}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={3} className="px-6 py-6 text-center text-sm text-slate-500">
                              No lines in this section for the period.
                            </td>
                          </tr>
                        )}
                        <tr className="bg-slate-50/90 font-semibold">
                          <td colSpan={2} className="px-5 py-3 text-sm text-slate-800 sm:px-6">
                            Section total
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-right text-sm tabular-nums text-slate-900 sm:px-6">
                            {formatCurrency(section.subtotal)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </RetailBackofficeCard>
              ) : null)}

            <RetailBackofficeCard
              padding="p-5 sm:p-6"
              className={
                data.totals.net_profit >= 0 ? "border-slate-300/80 bg-slate-50/30" : "border-amber-200/90 bg-amber-50/25"
              }
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Bottom line</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">
                    Net {data.totals.net_profit >= 0 ? "profit" : "loss"}
                  </h2>
                </div>
                <p className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {formatCurrency(data.totals.net_profit)}
                </p>
              </div>
              {revenueTotal > 0 ? (
                <p className="mt-3 text-sm text-slate-600">
                  Net margin on revenue:{" "}
                  <span className="font-medium text-slate-900">
                    {((data.totals.net_profit / revenueTotal) * 100).toFixed(2)}%
                  </span>
                </p>
              ) : null}
            </RetailBackofficeCard>
          </>
        ) : null}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}














