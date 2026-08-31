/**
 * Monthly chart selection — selected period is independent of visible-bar fallback.
 */

import {
  normalizePeriodStart,
  periodStartYearMonth,
  samePeriodStart,
} from "@/lib/accounting/periodDate"

export type TrendsTimelinePoint = {
  period_start: string
  period_end: string
  revenue: number
  expenses: number
  netProfit: number
}

export type MonthlyTrendsSelection = {
  selectedPeriodStart: string | undefined
  selectedPeriodEnd: string | undefined
  selectedRevenue: number
  selectedExpenses: number
  selectedNetProfit: number
  barVisible: boolean
  highlightPeriodStart: string | null
  usedMetricsFallback: boolean
}

/**
 * Drop periods that start after business today. If every row is future-dated,
 * keep the full list rather than inventing or emptying the chart.
 */
export function filterNonFutureTimelinePoints<T extends { period_start: string }>(
  points: T[],
  businessToday: string | null | undefined
): T[] {
  if (points.length === 0) return []
  const sorted = [...points].sort((a, b) =>
    normalizePeriodStart(a.period_start).localeCompare(normalizePeriodStart(b.period_start))
  )
  const todayYm = periodStartYearMonth(businessToday)
  if (!todayYm) return sorted
  const notFuture = sorted.filter((p) => periodStartYearMonth(p.period_start) <= todayYm)
  return notFuture.length > 0 ? notFuture : sorted
}

export function resolveMonthlyTrendsSelection(input: {
  visibleMonths: TrendsTimelinePoint[]
  dashboardPeriodStart?: string | null
  dashboardPeriodEnd?: string | null
  currentRevenue: number
  currentExpenses: number
  currentNetProfit: number
}): MonthlyTrendsSelection {
  const dashboardStart = normalizePeriodStart(input.dashboardPeriodStart)
  const dashboardEnd = normalizePeriodStart(input.dashboardPeriodEnd)
  const matched = dashboardStart
    ? input.visibleMonths.find((m) => samePeriodStart(m.period_start, dashboardStart)) ?? null
    : null

  if (dashboardStart) {
    if (matched) {
      return {
        selectedPeriodStart: normalizePeriodStart(matched.period_start),
        selectedPeriodEnd: normalizePeriodStart(matched.period_end) || dashboardEnd || undefined,
        selectedRevenue: matched.revenue,
        selectedExpenses: matched.expenses,
        selectedNetProfit: matched.netProfit,
        barVisible: true,
        highlightPeriodStart: normalizePeriodStart(matched.period_start),
        usedMetricsFallback: false,
      }
    }
    return {
      selectedPeriodStart: dashboardStart,
      selectedPeriodEnd: dashboardEnd || undefined,
      selectedRevenue: input.currentRevenue,
      selectedExpenses: input.currentExpenses,
      selectedNetProfit: input.currentNetProfit,
      barVisible: false,
      highlightPeriodStart: null,
      usedMetricsFallback: true,
    }
  }

  const latest = input.visibleMonths[input.visibleMonths.length - 1] ?? null
  if (latest) {
    return {
      selectedPeriodStart: normalizePeriodStart(latest.period_start),
      selectedPeriodEnd: normalizePeriodStart(latest.period_end) || undefined,
      selectedRevenue: latest.revenue,
      selectedExpenses: latest.expenses,
      selectedNetProfit: latest.netProfit,
      barVisible: true,
      highlightPeriodStart: normalizePeriodStart(latest.period_start),
      usedMetricsFallback: false,
    }
  }

  return {
    selectedPeriodStart: undefined,
    selectedPeriodEnd: undefined,
    selectedRevenue: input.currentRevenue,
    selectedExpenses: input.currentExpenses,
    selectedNetProfit: input.currentNetProfit,
    barVisible: false,
    highlightPeriodStart: null,
    usedMetricsFallback: true,
  }
}
