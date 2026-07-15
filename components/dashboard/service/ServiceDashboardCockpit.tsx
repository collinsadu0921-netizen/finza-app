"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import CollectionsFollowUpSection from "./CollectionsFollowUpSection"
import DashboardHeader from "./DashboardHeader"
import QuickActionsBar from "./QuickActionsBar"
import RecentActivityFeed from "./RecentActivityFeed"
import type { ActivityItem } from "./RecentActivityFeed"
import FinancialOverviewStrip from "./FinancialOverviewStrip"
import DashboardTopActions from "@/components/support/DashboardTopActions"
import ServiceDashboardSkeleton, {
  ServiceDashboardActivityPanelSkeleton,
  ServiceDashboardCollectionsFollowUpSkeleton,
  ServiceDashboardFinancialOverviewSkeleton,
  ServiceDashboardTrendsPanelSkeleton,
} from "./ServiceDashboardSkeleton"
import DashboardErrorBanner from "./DashboardErrorBanner"
import { DEFAULT_PLATFORM_CURRENCY_CODE } from "@/lib/currency"

const TrendsSectionLazy = dynamic(() => import("./TrendsSection"), {
  loading: () => <ServiceDashboardTrendsPanelSkeleton />,
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
  unpaidInvoicesTotal?: number
  unpaidInvoicesCount?: number
  overdueInvoicesTotal?: number
  overdueInvoicesCount?: number
  metrics_source?: string
  live_fallback_used?: boolean
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

function devServiceDashboardLog(label: string, startedAt: number) {
  if (process.env.NODE_ENV === "production") return
  console.info(`[service/dashboard] ${label}: ${(performance.now() - startedAt).toFixed(1)}ms`)
}

function isAbortOrCancelled(reason: unknown): boolean {
  if (reason instanceof DOMException && reason.name === "AbortError") return true
  if (reason instanceof Error && reason.name === "AbortError") return true
  return false
}

export type ServiceDashboardCockpitProps = {
  business: Business
  /** Workspace identity (logo + title); date + Refresh align to the right when set. */
  headerLead?: ReactNode
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
  {
    label: "Create Invoice",
    href: "/service/invoices/new",
    icon: "invoice" as const,
    dataTour: "service-dashboard-create-invoice",
  },
  { label: "Recurring invoices", href: "/service/recurring", icon: "recurring" as const },
  { label: "Record Expense", href: "/service/expenses/create", icon: "expense" as const },
  { label: "Add Customer", href: "/service/customers/new", icon: "customer" as const },
  { label: "View Reports", href: "/service/reports/profit-and-loss", icon: "reports" as const },
]

async function fetchDashboardCluster(
  businessId: string,
  options: { periodStart?: string | null; previousPeriodStart?: string | null },
  signal?: AbortSignal
): Promise<{
  timeline: TimelineItem[]
  metrics: Metrics
  activity: { items: ActivityItem[] }
} | null> {
  const params = new URLSearchParams({
    business_id: businessId,
    periods: "12",
    activity_limit: "10",
  })
  if (options.periodStart) {
    params.set("period_start", options.periodStart)
    if (options.previousPeriodStart) {
      params.set("previous_period_start", options.previousPeriodStart)
    }
  }
  const res = await fetch(`/api/dashboard/service-cluster?${params.toString()}`, {
    signal,
    cache: "no-store",
  })
  if (!res.ok) {
    let errMessage = `Request failed (${res.status})`
    try {
      const body = await res.json()
      errMessage = body?.error ?? body?.message ?? errMessage
    } catch {
      /* ignore */
    }
    throw new Error(errMessage)
  }
  return res.json()
}

async function fetchTimelineData(
  businessId: string,
  signal?: AbortSignal
): Promise<TimelineItem[]> {
  if (SERVICE_ANALYTICS_V2) {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - 365)
    const timelineRes = await fetch(
      `/api/dashboard/service-analytics?business_id=${encodeURIComponent(businessId)}&start_date=${start.toISOString().split("T")[0]}&end_date=${end.toISOString().split("T")[0]}&interval=day`,
      { signal }
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
    `/api/dashboard/service-timeline?business_id=${encodeURIComponent(businessId)}&periods=12`,
    { signal, cache: "no-store" }
  )
  return timelineRes.ok ? (await timelineRes.json()).timeline ?? [] : []
}

async function fetchMetricsPayload(
  params: URLSearchParams,
  signal?: AbortSignal
): Promise<{ ok: true; payload: Metrics } | { ok: false; errMessage: string }> {
  const res = await fetch(`/api/dashboard/service-metrics?${params.toString()}`, {
    signal,
    cache: "no-store",
  })
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

async function fetchActivityItems(
  businessId: string,
  signal?: AbortSignal
): Promise<ActivityItem[]> {
  const actRes = await fetch(
    `/api/dashboard/service-activity?business_id=${encodeURIComponent(businessId)}&limit=10`,
    { signal, cache: "no-store" }
  )
  if (!actRes.ok) return []
  const actJson = await actRes.json()
  return actJson.items ?? []
}

export default function ServiceDashboardCockpit({ business, headerLead }: ServiceDashboardCockpitProps) {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([])
  const [loadingMetrics, setLoadingMetrics] = useState(true)
  const [loadingTimeline, setLoadingTimeline] = useState(true)
  const [loadingActivity, setLoadingActivity] = useState(true)
  const [selectedPeriodStart, setSelectedPeriodStart] = useState<string | null>(null)
  const [metricsError, setMetricsError] = useState<string | null>(null)

  /** Monotonic generation — stale async completions must not overwrite state. */
  const loadGenerationRef = useRef(0)
  const loadAbortRef = useRef<AbortController | null>(null)

  const rawMetricsCurrency = metrics?.currency
  const metricsCurrencyCode = typeof rawMetricsCurrency === "object" && rawMetricsCurrency !== null
    ? rawMetricsCurrency.code
    : rawMetricsCurrency as string | undefined
  const currencyCode =
    business?.default_currency ?? metricsCurrencyCode ?? DEFAULT_PLATFORM_CURRENCY_CODE

  const load = useCallback(async () => {
    const businessId = business?.id
    if (!businessId) {
      loadAbortRef.current?.abort()
      loadAbortRef.current = null
      setLoadingMetrics(false)
      setLoadingTimeline(false)
      setLoadingActivity(false)
      return
    }

    loadGenerationRef.current += 1
    const gen = loadGenerationRef.current
    loadAbortRef.current?.abort()
    const ac = new AbortController()
    loadAbortRef.current = ac
    const signal = ac.signal

    const isLatest = () => loadGenerationRef.current === gen

    const tCockpit = performance.now()
    setLoadingMetrics(true)
    setLoadingTimeline(true)
    setLoadingActivity(true)
    setMetricsError(null)

    const runTimed = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
      const t0 = performance.now()
      try {
        return await fn()
      } finally {
        devServiceDashboardLog(label, t0)
      }
    }

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
      if (SERVICE_ANALYTICS_V2) {
        const needsTimelineBeforeMetrics =
          selectedPeriodStart != null && selectedPeriodStart !== ""

        if (needsTimelineBeforeMetrics) {
          const tl = await runTimed("timeline fetch", () => fetchTimelineData(businessId, signal))
          if (!isLatest()) return

          setTimeline(tl)
          setLoadingTimeline(false)

          const params = new URLSearchParams({ business_id: businessId })
          params.set("period_start", selectedPeriodStart!)
          const idx = tl.findIndex((t) => t.period_start === selectedPeriodStart)
          if (idx > 0) {
            params.set("previous_period_start", tl[idx - 1].period_start)
          }

          const [metricsSettled, activitySettled] = await Promise.allSettled([
            runTimed("service-metrics fetch", () => fetchMetricsPayload(params, signal)),
            runTimed("activity fetch", () => fetchActivityItems(businessId, signal)),
          ])

          if (!isLatest()) return

          setLoadingMetrics(false)
          if (metricsSettled.status === "fulfilled") {
            applyMetricsResult(metricsSettled.value)
          } else if (!isAbortOrCancelled(metricsSettled.reason)) {
            setMetrics(null)
            setMetricsError(
              metricsSettled.reason instanceof Error
                ? metricsSettled.reason.message
                : "Failed to load metrics"
            )
          }

          setLoadingActivity(false)
          if (activitySettled.status === "fulfilled") {
            setActivityItems(activitySettled.value)
          } else if (!isAbortOrCancelled(activitySettled.reason)) {
            setActivityItems([])
          }
        } else {
          const baseParams = new URLSearchParams({ business_id: businessId })
          const [timelineSettled, metricsSettled, activitySettled] =
            await Promise.allSettled([
              runTimed("timeline fetch", () => fetchTimelineData(businessId, signal)),
              runTimed("service-metrics fetch", () => fetchMetricsPayload(baseParams, signal)),
              runTimed("activity fetch", () => fetchActivityItems(businessId, signal)),
            ])

          if (!isLatest()) return

          setLoadingTimeline(false)
          if (timelineSettled.status === "fulfilled") {
            setTimeline(timelineSettled.value)
          } else if (!isAbortOrCancelled(timelineSettled.reason)) {
            setTimeline([])
          }

          setLoadingMetrics(false)
          if (metricsSettled.status === "fulfilled") {
            applyMetricsResult(metricsSettled.value)
          } else if (!isAbortOrCancelled(metricsSettled.reason)) {
            setMetrics(null)
            setMetricsError(
              metricsSettled.reason instanceof Error
                ? metricsSettled.reason.message
                : "Failed to load metrics"
            )
          }

          setLoadingActivity(false)
          if (activitySettled.status === "fulfilled") {
            setActivityItems(activitySettled.value)
          } else if (!isAbortOrCancelled(activitySettled.reason)) {
            setActivityItems([])
          }
        }
      } else {
        const [clusterSettled] = await Promise.allSettled([
          runTimed("service-cluster fetch", () =>
            fetchDashboardCluster(
              businessId,
              {
                periodStart:
                  selectedPeriodStart != null && selectedPeriodStart !== ""
                    ? selectedPeriodStart
                    : undefined,
              },
              signal
            )
          ),
        ])

        if (!isLatest()) return

        setLoadingTimeline(false)
        setLoadingMetrics(false)
        setLoadingActivity(false)

        if (clusterSettled.status === "fulfilled" && clusterSettled.value) {
          setTimeline(clusterSettled.value.timeline)
          setMetrics(clusterSettled.value.metrics)
          setMetricsError(null)
          setActivityItems(clusterSettled.value.activity.items ?? [])
        } else if (
          clusterSettled.status === "rejected" &&
          !isAbortOrCancelled(clusterSettled.reason)
        ) {
          setMetrics(null)
          setTimeline([])
          setActivityItems([])
          setMetricsError(
            clusterSettled.reason instanceof Error
              ? clusterSettled.reason.message
              : "Failed to load dashboard"
          )
        }
      }
    } catch (e) {
      if (!isLatest()) return
      if (isAbortOrCancelled(e)) return
      setMetrics(null)
      setTimeline([])
      setActivityItems([])
      setMetricsError(e instanceof Error ? e.message : "Network or unexpected error")
      setLoadingTimeline(false)
      setLoadingMetrics(false)
      setLoadingActivity(false)
    } finally {
      if (loadGenerationRef.current === gen) {
        devServiceDashboardLog("total cockpit load", tCockpit)
      }
    }
  }, [business?.id, selectedPeriodStart])

  const anyLoading = loadingMetrics || loadingTimeline || loadingActivity

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

  const trendsFocusPeriodStart =
    selectedPeriodStart != null && selectedPeriodStart !== ""
      ? selectedPeriodStart
      : (metrics?.period?.period_start ?? null)

  const chartData = timeline.map((t) => ({
    period_start: t.period_start,
    period_end: t.period_end,
    label: formatPeriodLabel(t.period_start, t.period_end),
    revenue: t.revenue,
    expenses: t.expenses,
    netProfit: t.netProfit,
    cashMovement: t.cashMovement,
  }))

  const livePositions =
    metrics?.positionBalancesAsOfToday &&
    metrics?.positionAsOfDate &&
    metrics.positionAsOfDate.length >= 10
  const positionAsOfPrefix = livePositions
    ? `As of ${formatShortIsoDate(metrics.positionAsOfDate!)} · `
    : ""

  const workspaceTopBar =
    headerLead != null ? (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">{headerLead}</div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end sm:pt-0.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400 sm:max-w-[16rem] sm:text-right dark:text-slate-500">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
          <DashboardTopActions onRefresh={load} refreshing={anyLoading} />
        </div>
      </div>
    ) : null

  if (!business?.id) {
    return (
      <div className="space-y-5">
        {workspaceTopBar}
        <ServiceDashboardSkeleton />
      </div>
    )
  }

  const routes = getDashboardRoutes(business.id)
  const ledgerFallbackActive =
    metrics?.metrics_source === "ledger_live_fallback" || metrics?.live_fallback_used === true

  return (
    <div className="space-y-5" data-tour="service-dashboard-overview">
      <div className="space-y-2.5">
        {workspaceTopBar}

        {metricsError && !loadingMetrics && (
          <DashboardErrorBanner
            message={
              metricsError
                ? "We could not load your dashboard summary. Please refresh and try again."
                : undefined
            }
            onRetry={load}
          />
        )}

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
          showRefreshButton={headerLead == null}
          showHelpLink={headerLead == null}
        />

        <QuickActionsBar actions={QUICK_ACTIONS} businessId={business.id} />

        {loadingMetrics ? (
          <ServiceDashboardFinancialOverviewSkeleton />
        ) : metrics ? (
          <FinancialOverviewStrip
            cashBalance={metrics.cashBalance ?? 0}
            accountsReceivable={metrics.accountsReceivable ?? 0}
            currentLiabilities={metrics.accountsPayable ?? 0}
            unpaidInvoicesTotal={metrics.unpaidInvoicesTotal ?? 0}
            unpaidInvoicesCount={metrics.unpaidInvoicesCount ?? 0}
            overdueInvoicesTotal={metrics.overdueInvoicesTotal ?? 0}
            overdueInvoicesCount={metrics.overdueInvoicesCount ?? 0}
            currencyCode={currencyCode}
            positionAsOfPrefix={positionAsOfPrefix}
          />
        ) : null}
      </div>

      {/* Trends — full-width profit performance panel (chart + breakdown need room) */}
      {loadingTimeline ? (
        <ServiceDashboardTrendsPanelSkeleton />
      ) : (
        <TrendsSectionLazy
          data={chartData}
          currencyCode={currencyCode}
          currentRevenue={metrics?.revenue ?? 0}
          currentExpenses={metrics?.expenses ?? 0}
          currentNetProfit={metrics?.netProfit ?? 0}
          businessId={business.id}
          fallbackPeriodStart={metrics?.period?.period_start}
          fallbackPeriodEnd={metrics?.period?.period_end}
          dashboardPeriodStart={metrics?.period?.period_start ?? null}
          dashboardPeriodEnd={metrics?.period?.period_end ?? null}
          periodCaption={
            ledgerFallbackActive ? "Based on ledger records for this period" : undefined
          }
        />
      )}

      {loadingMetrics ? (
        <ServiceDashboardCollectionsFollowUpSkeleton />
      ) : metrics ? (
        <CollectionsFollowUpSection
          cashCollected={metrics.cashCollected ?? 0}
          overdueCount={metrics.overdueInvoicesCount ?? 0}
          overdueTotal={metrics.overdueInvoicesTotal ?? 0}
          currencyCode={currencyCode}
          cashReportHref={
            metrics.period?.period_start && metrics.period?.period_end
              ? `/service/payments?business_id=${encodeURIComponent(business.id)}&start_date=${encodeURIComponent(metrics.period.period_start)}&end_date=${encodeURIComponent(metrics.period.period_end)}`
              : `/service/payments?business_id=${encodeURIComponent(business.id)}`
          }
          overdueReportHref={`/service/invoices?business_id=${encodeURIComponent(business.id)}&status=overdue`}
        />
      ) : null}

      {/* Recent Activity — secondary row below the Trends panel */}
      {loadingActivity ? (
        <ServiceDashboardActivityPanelSkeleton />
      ) : (
        <RecentActivityFeed
          items={activityItems}
          currencyCode={currencyCode}
          maxItems={5}
        />
      )}
    </div>
  )
}
