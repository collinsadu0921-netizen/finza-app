"use client"

import { useCallback, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { supabase } from "@/lib/supabaseClient"
import MetricCard from "./MetricCard"
import DashboardHeader from "./DashboardHeader"
import QuickActionsBar from "./QuickActionsBar"
import RecentActivityFeed from "./RecentActivityFeed"
import type { ActivityItem } from "./RecentActivityFeed"
import ServiceDashboardSkeleton from "./ServiceDashboardSkeleton"
import DashboardErrorBanner from "./DashboardErrorBanner"

const TrendsSectionLazy = dynamic(() => import("./TrendsSection"), {
  loading: () => (
    <div
      className="h-72 w-full animate-pulse rounded-xl border border-slate-200 bg-slate-100/80 dark:border-slate-700 dark:bg-slate-800/50"
      aria-hidden
    />
  ),
  ssr: false,
})

type Business = { id: string; default_currency?: string }

type Metrics = {
  period: { period_start?: string; period_end?: string }
  currency: string | { code: string; symbol: string; name: string }
  revenue: number
  expenses: number
  netProfit: number
  cashCollected: number
  accountsReceivable: number
  accountsPayable: number
  cashBalance: number
  /** When true, cash/AR/AP are balance-sheet as-of today while period above is P&L only. */
  positionBalancesAsOfToday?: boolean
  positionAsOfDate?: string | null
  previousPeriod?: {
    revenue: number
    expenses: number
    netProfit: number
    cashCollected: number
    accountsReceivable: number | null
    accountsPayable: number | null
    cashBalance: number | null
  } | null
}

type TimelineItem = {
  period_id?: string
  period_start: string
  period_end: string
  revenue: number
  expenses: number
  netProfit: number
  cashMovement?: number
}

const SERVICE_ANALYTICS_V2 = process.env.NEXT_PUBLIC_SERVICE_ANALYTICS_V2 === "true"

export type ServiceDashboardCockpitProps = {
  business: Business
}

/** Returns "Mar '26" for same-month periods, "Jan '26 – Mar '26" for ranges. */
function formatPeriodLabel(start: string, end: string): string {
  // Compare year-month directly on the ISO string to avoid timezone issues
  const sYM = start.slice(0, 7)
  const eYM = end.slice(0, 7)
  const s = new Date(start + "T12:00:00")
  const e = new Date(end + "T12:00:00")
  const opts: Intl.DateTimeFormatOptions = { month: "short", year: "2-digit" }
  if (sYM === eYM) {
    return s.toLocaleDateString(undefined, opts)
  }
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`
}

function formatShortIsoDate(iso: string): string {
  const d = new Date(iso + "T12:00:00")
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

/** Service workspace dashboard card → route. */
function getDashboardRoutes(businessId: string) {
  const q = (path: string) => `${path}?business_id=${encodeURIComponent(businessId)}`
  return {
    revenue: "/service/reports/profit-and-loss",
    expenses: "/service/expenses/activity",
    netProfit: "/service/reports/profit-and-loss",
    accountsReceivable: "/service/reports/balance-sheet",
    accountsPayable: "/service/reports/balance-sheet",
    cashBalance: q("/service/ledger"),
    balanceSheet: "/service/reports/balance-sheet",
  } as const
}

const QUICK_ACTIONS = [
  { label: "Create Invoice", href: "/service/invoices/new", icon: "invoice" as const },
  { label: "Record Expense", href: "/service/expenses/create", icon: "expense" as const },
  { label: "Add Customer", href: "/service/customers/new", icon: "customer" as const },
  { label: "View Reports", href: "/service/reports/profit-and-loss", icon: "reports" as const },
]

async function fetchTimelineData(businessId: string): Promise<TimelineItem[]> {
  if (SERVICE_ANALYTICS_V2) {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - 365)
    const timelineRes = await fetch(
      `/api/dashboard/service-analytics?business_id=${encodeURIComponent(businessId)}&start_date=${start.toISOString().split("T")[0]}&end_date=${end.toISOString().split("T")[0]}&interval=day`
    )
    const json = timelineRes.ok ? await timelineRes.json() : {}
    return (json.timeline ?? []).map((r: Record<string, unknown>) => ({
      period_start: r.period_start as string,
      period_end: r.period_end as string,
      revenue: (r.revenue as number) ?? 0,
      expenses: (r.expenses as number) ?? 0,
      netProfit: (r.netProfit as number) ?? 0,
      cashMovement: (r.cashMovement as number) ?? 0,
    }))
  }
  const timelineRes = await fetch(
    `/api/dashboard/service-timeline?business_id=${encodeURIComponent(businessId)}&periods=12`
  )
  return timelineRes.ok ? (await timelineRes.json()).timeline ?? [] : []
}

async function fetchMetricsPayload(
  params: URLSearchParams
): Promise<{ ok: true; payload: Metrics } | { ok: false; errMessage: string }> {
  const res = await fetch(`/api/dashboard/service-metrics?${params.toString()}`)
  if (res.ok) {
    return { ok: true, payload: await res.json() }
  }
  let errMessage: string
  try {
    const body = await res.json()
    errMessage = body?.error ?? body?.message ?? `Request failed (${res.status})`
  } catch {
    errMessage = `Request failed (${res.status})`
  }
  return { ok: false, errMessage }
}

async function fetchActivityItems(businessId: string): Promise<ActivityItem[]> {
  const actRes = await fetch(
    `/api/dashboard/service-activity?business_id=${encodeURIComponent(businessId)}&limit=10`
  )
  if (!actRes.ok) return []
  const actJson = await actRes.json()
  return actJson.items ?? []
}

async function fetchOverdueInvoiceCount(businessId: string): Promise<number | null> {
  try {
    const today = new Date().toISOString().split("T")[0]
    const { count } = await supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .in("status", ["sent", "overdue", "partial"])
      .lt("due_date", today)
    return count ?? 0
  } catch {
    return null
  }
}

export default function ServiceDashboardCockpit({ business }: ServiceDashboardCockpitProps) {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([])
  const [overdueCount, setOverdueCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedPeriodStart, setSelectedPeriodStart] = useState<string | null>(null)
  const [metricsError, setMetricsError] = useState<string | null>(null)

  const rawMetricsCurrency = metrics?.currency
  const metricsCurrencyCode = typeof rawMetricsCurrency === "object" && rawMetricsCurrency !== null
    ? rawMetricsCurrency.code
    : rawMetricsCurrency as string | undefined
  const currencyCode = business?.default_currency ?? metricsCurrencyCode ?? "USD"

  const load = useCallback(async () => {
    const businessId = business?.id
    if (!businessId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setMetricsError(null)

    const applyMetricsResult = (
      result: { ok: true; payload: Metrics } | { ok: false; errMessage: string }
    ) => {
      if (result.ok) {
        setMetrics(result.payload)
        setMetricsError(null)
      } else {
        setMetrics(null)
        setMetricsError(result.errMessage)
      }
    }

    try {
      const needsTimelineBeforeMetrics =
        selectedPeriodStart != null && selectedPeriodStart !== ""

      if (needsTimelineBeforeMetrics) {
        const tl = await fetchTimelineData(businessId)
        setTimeline(tl)

        const params = new URLSearchParams({ business_id: businessId })
        params.set("period_start", selectedPeriodStart!)
        const idx = tl.findIndex((t) => t.period_start === selectedPeriodStart)
        if (idx > 0) {
          params.set("previous_period_start", tl[idx - 1].period_start)
        }

        const [metricsResult, activity, overdue] = await Promise.all([
          fetchMetricsPayload(params),
          fetchActivityItems(businessId),
          fetchOverdueInvoiceCount(businessId),
        ])
        applyMetricsResult(metricsResult)
        setActivityItems(activity)
        setOverdueCount(overdue)
      } else {
        const baseParams = new URLSearchParams({ business_id: businessId })
        const [tl, metricsResult, activity, overdue] = await Promise.all([
          fetchTimelineData(businessId),
          fetchMetricsPayload(baseParams),
          fetchActivityItems(businessId),
          fetchOverdueInvoiceCount(businessId),
        ])
        setTimeline(tl)
        applyMetricsResult(metricsResult)
        setActivityItems(activity)
        setOverdueCount(overdue)
      }
    } catch (e) {
      setMetrics(null)
      setTimeline([])
      setMetricsError(e instanceof Error ? e.message : "Network or unexpected error")
    } finally {
      setLoading(false)
    }
  }, [business?.id, selectedPeriodStart])

  useEffect(() => {
    load()
  }, [load])

  const periodLabel =
    metrics?.period?.period_start && metrics?.period?.period_end
      ? formatPeriodLabel(metrics.period.period_start, metrics.period.period_end)
      : "—"

  const periodOptions: { value: string; label: string }[] = [
    { value: "", label: "Latest period" },
    ...timeline.map((t) => ({
      value: t.period_start,
      label: formatPeriodLabel(t.period_start, t.period_end),
    })),
  ]

  const showEmptyPeriodCta =
    !!metrics &&
    selectedPeriodStart != null &&
    selectedPeriodStart !== "" &&
    metrics.revenue === 0 &&
    metrics.expenses === 0 &&
    metrics.netProfit === 0

  const handleSwitchToLastActive = () => {
    setSelectedPeriodStart(null)
  }

  const chartData = timeline.map((t) => ({
    period_start: t.period_start,
    period_end: t.period_end,
    label: formatPeriodLabel(t.period_start, t.period_end),
    revenue: t.revenue,
    expenses: t.expenses,
    netProfit: t.netProfit,
    cashMovement: t.cashMovement,
  }))

  const spark = (key: keyof TimelineItem) =>
    timeline.length > 0 ? timeline.map((t) => t[key] as number) : undefined

  const prev = metrics?.previousPeriod ?? null
  const routes = getDashboardRoutes(business.id)

  const profitMarginPct =
    metrics && metrics.revenue > 0
      ? Math.round((metrics.netProfit / metrics.revenue) * 1000) / 10
      : null

  const collectionRatePct =
    metrics && metrics.revenue > 0
      ? Math.round((metrics.cashCollected / metrics.revenue) * 1000) / 10
      : null

  const livePositions =
    metrics?.positionBalancesAsOfToday &&
    metrics?.positionAsOfDate &&
    metrics.positionAsOfDate.length >= 10
  const positionAsOfPrefix = livePositions
    ? `As of ${formatShortIsoDate(metrics.positionAsOfDate!)} · `
    : ""

  if (loading && !metrics) {
    return <ServiceDashboardSkeleton />
  }

  if (metrics === null && !loading) {
    return (
      <div className="space-y-6">
        <DashboardErrorBanner
          message={metricsError ?? "Could not load dashboard metrics. Please try again."}
          onRetry={load}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <DashboardHeader
        periodLabel={periodLabel}
        currencyCode={currencyCode}
        lastUpdatedLabel="Live"
        periodOptions={periodOptions}
        selectedPeriodStart={selectedPeriodStart ?? ""}
        onPeriodChange={(v) => setSelectedPeriodStart(v || null)}
        showEmptyPeriodCta={showEmptyPeriodCta}
        onSwitchToLastActive={handleSwitchToLastActive}
        onRefresh={load}
      />

      <QuickActionsBar actions={QUICK_ACTIONS} businessId={business.id} />

      {/* Primary KPI grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          title="Revenue"
          value={metrics?.revenue ?? 0}
          previousValue={prev?.revenue}
          sparklineData={spark("revenue")}
          sparklineColor="#10b981"
          reportHref={routes.revenue}
          currencyCode={currencyCode}
          subtitle="billed this period"
          variant="default"
        />
        <MetricCard
          title="Expenses"
          value={metrics?.expenses ?? 0}
          previousValue={prev?.expenses}
          sparklineData={spark("expenses")}
          sparklineColor="#ef4444"
          reportHref={routes.expenses}
          currencyCode={currencyCode}
          variant="default"
        />
        <MetricCard
          title="Net Profit"
          value={metrics?.netProfit ?? 0}
          previousValue={prev?.netProfit}
          sparklineData={spark("netProfit")}
          sparklineColor={(metrics?.netProfit ?? 0) >= 0 ? "#3b82f6" : "#f97316"}
          reportHref={routes.netProfit}
          currencyCode={currencyCode}
          subtitle={profitMarginPct != null ? `${profitMarginPct}% margin` : undefined}
          variant={(metrics?.netProfit ?? 0) >= 0 ? "positive" : "negative"}
        />
        <MetricCard
          title="Cash Balance"
          value={metrics?.cashBalance ?? 0}
          previousValue={prev?.cashBalance ?? undefined}
          sparklineColor="#6366f1"
          reportHref={routes.cashBalance}
          currencyCode={currencyCode}
          subtitle={`${positionAsOfPrefix}bank account balance`}
          variant={(metrics?.cashBalance ?? 0) < 0 ? "negative" : "default"}
        />
      </div>

      {/* Secondary KPI grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          title="Accounts Receivable"
          value={metrics?.accountsReceivable ?? 0}
          previousValue={prev?.accountsReceivable ?? undefined}
          reportHref={routes.accountsReceivable}
          currencyCode={currencyCode}
          subtitle={`${positionAsOfPrefix}outstanding from clients`}
        />
        <MetricCard
          title="Accounts Payable"
          value={metrics?.accountsPayable ?? 0}
          previousValue={prev?.accountsPayable ?? undefined}
          reportHref={routes.accountsPayable}
          currencyCode={currencyCode}
          subtitle={`${positionAsOfPrefix}owed to suppliers`}
        />
        <MetricCard
          title="Cash Collected"
          value={metrics?.cashCollected ?? 0}
          previousValue={prev?.cashCollected}
          currencyCode={currencyCode}
          subtitle={collectionRatePct != null ? `${collectionRatePct}% of billed` : "payments received"}
          reportHref={routes.cashBalance}
          variant="default"
        />
        <MetricCard
          title="Overdue Invoices"
          value={overdueCount}
          currencyCode={currencyCode}
          valueFormat="count"
          subtitle={overdueCount === 1 ? "invoice past due" : "invoices past due"}
          variant={overdueCount != null && overdueCount > 0 ? "negative" : "default"}
          static
        />
      </div>

      {/* Trends + Recent Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrendsSectionLazy
            data={chartData}
            currencyCode={currencyCode}
            currentRevenue={metrics?.revenue ?? 0}
            currentExpenses={metrics?.expenses ?? 0}
            currentNetProfit={metrics?.netProfit ?? 0}
          />
        </div>
        <div>
          <RecentActivityFeed
            items={activityItems}
            currencyCode={currencyCode}
            emptyMessage="No journal entries yet"
          />
        </div>
      </div>
    </div>
  )
}
