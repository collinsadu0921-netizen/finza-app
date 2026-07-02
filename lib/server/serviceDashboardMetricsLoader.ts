/**
 * Shared service dashboard metrics payload loader.
 */

import type { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getBusinessToday } from "@/lib/accounting/businessDate"
import { resolvePnLMovementRange } from "@/lib/accounting/reports/resolvePnLMovementRange"
import { getCurrencyName, getCurrencySymbol } from "@/lib/currency"
import {
  dashboardMetricsCacheKey,
  isDashboardMetricsCacheEnabled,
  loadOrComputeDashboardMetrics,
} from "@/lib/server/dashboardMetricsCache"
import {
  dashboardPnlSourceForDiag,
  fetchFreshDashboardPeriodPnl,
  isDashboardPnlSummaryFastPathEnabled,
} from "@/lib/server/dashboardPeriodSummaryRead"
import { classifySupabaseError, logSupabaseRpcFailure } from "@/lib/server/logSupabaseRpcError"
import type { RouteDiagFields } from "@/lib/server/routeDiagnostics"
import type { createRouteDiag } from "@/lib/server/routeDiagnostics"

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>
type RouteDiag = ReturnType<typeof createRouteDiag>

type PreviousPeriodPayload = {
  revenue: number
  expenses: number
  netProfit: number
  cashCollected: number
  accountsReceivable: number | null
  accountsPayable: number | null
  cashBalance: number | null
}

type DashboardMetricsRpcResult = {
  currency_code?: string
  revenue?: number | string
  expenses?: number | string
  net_profit?: number | string
  cash_collected?: number | string
  cash_balance?: number | string
  accounts_receivable?: number | string
  accounts_payable?: number | string
  previous_revenue?: number | string
  previous_expenses?: number | string
  previous_net_profit?: number | string
  previous_cash_collected?: number | string
  previous_cash_balance?: number | string
  previous_accounts_receivable?: number | string
  previous_accounts_payable?: number | string
}

export type ServiceDashboardMetricsPayload = {
  period: {
    period_id?: string
    period_start: string
    period_end: string
    resolution_reason?: string
  }
  currency: { code: string; symbol: string; name: string }
  revenue: number
  expenses: number
  netProfit: number
  cashCollected: number
  accountsReceivable: number
  accountsPayable: number
  cashBalance: number
  positionBalancesAsOfToday: boolean
  positionAsOfDate: string
  previousPeriod: PreviousPeriodPayload | null
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function num(v: unknown): number {
  return roundMoney(Number(v) || 0)
}

export type ServiceDashboardMetricsParams = {
  periodId?: string
  periodStart?: string
  previousPeriodStart?: string
}

type PositionRow = {
  cash_balance?: number | string
  accounts_receivable?: number | string
  accounts_payable?: number | string
}

async function loadBusinessCurrency(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ code: string; symbol: string; name: string }> {
  const { data: biz } = await supabase
    .from("businesses")
    .select("default_currency")
    .eq("id", businessId)
    .single()
  const currencyCode = String(biz?.default_currency ?? "GHS")
  return {
    code: currencyCode,
    symbol: getCurrencySymbol(currencyCode) || currencyCode,
    name: getCurrencyName(currencyCode) || currencyCode,
  }
}

async function loadPositionsAsOf(
  supabase: SupabaseClient,
  businessId: string,
  asOfDate: string
): Promise<PositionRow> {
  const { data, error } = await supabase.rpc("finza_dashboard_positions_as_of", {
    p_business_id: businessId,
    p_as_of_date: asOfDate,
  })
  if (error) {
    throw error
  }
  const row = Array.isArray(data) ? data[0] : data
  return (row ?? {}) as PositionRow
}

async function loadCashCollected(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const { data, error } = await supabase.rpc("get_cash_collected_total", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
  })
  if (error) {
    throw error
  }
  return num(data)
}

async function buildMetricsFromSummarySnapshot(
  supabase: SupabaseClient,
  businessId: string,
  range: {
    movementStart: string
    movementEnd: string
    period: { period_id: string; resolution_reason?: string }
  },
  positionAsOfDate: string,
  compareStart: string | null,
  compareEnd: string | null
): Promise<ServiceDashboardMetricsPayload | null> {
  const freshPnl = await fetchFreshDashboardPeriodPnl(
    supabase,
    businessId,
    range.movementStart,
    range.movementEnd
  )
  if (!freshPnl) return null

  let previousPeriod: PreviousPeriodPayload | null = null
  if (compareStart && compareEnd) {
    const prevPnl = await fetchFreshDashboardPeriodPnl(
      supabase,
      businessId,
      compareStart,
      compareEnd
    )
    if (!prevPnl) return null

    const [prevPositions, prevCash] = await Promise.all([
      loadPositionsAsOf(supabase, businessId, compareEnd),
      loadCashCollected(supabase, businessId, compareStart, compareEnd),
    ])

    previousPeriod = {
      revenue: num(prevPnl.revenue),
      expenses: num(prevPnl.expenses),
      netProfit: num(prevPnl.net_profit),
      cashCollected: prevCash,
      accountsReceivable: num(prevPositions.accounts_receivable),
      accountsPayable: num(prevPositions.accounts_payable),
      cashBalance: num(prevPositions.cash_balance),
    }
  }

  const [currency, positions, cashCollected] = await Promise.all([
    loadBusinessCurrency(supabase, businessId),
    loadPositionsAsOf(supabase, businessId, positionAsOfDate),
    loadCashCollected(supabase, businessId, range.movementStart, range.movementEnd),
  ])

  return {
    period: {
      period_id: range.period.period_id,
      period_start: range.movementStart,
      period_end: range.movementEnd,
      resolution_reason: range.period.resolution_reason,
    },
    currency,
    revenue: num(freshPnl.revenue),
    expenses: num(freshPnl.expenses),
    netProfit: num(freshPnl.net_profit),
    cashCollected,
    accountsReceivable: num(positions.accounts_receivable),
    accountsPayable: num(positions.accounts_payable),
    cashBalance: num(positions.cash_balance),
    positionBalancesAsOfToday: true,
    positionAsOfDate,
    previousPeriod,
  }
}

export async function loadServiceDashboardMetrics(
  supabase: SupabaseClient,
  businessId: string,
  params: ServiceDashboardMetricsParams,
  diag: RouteDiag
): Promise<ServiceDashboardMetricsPayload> {
  const { range, error: rangeError } = await resolvePnLMovementRange(supabase, {
    businessId,
    period_id: params.periodId,
    period_start: params.periodStart,
  })

  if (rangeError || !range) {
    throw new Error(rangeError ?? "Could not resolve period or fetch P&L")
  }

  diag.step("period_resolution", {
    period_start: range.movementStart,
    period_end: range.movementEnd,
  })

  const positionAsOfDate = await getBusinessToday(supabase, businessId)
  diag.step("business_today", { position_as_of_date: positionAsOfDate })

  const prevStart = params.previousPeriodStart?.trim() ? params.previousPeriodStart : null
  let compareStart: string | null = null
  let compareEnd: string | null = null

  if (prevStart) {
    const prevRangeOut = await resolvePnLMovementRange(supabase, {
      businessId,
      period_start: prevStart,
    })
    if (prevRangeOut.range) {
      compareStart = prevRangeOut.range.movementStart
      compareEnd = prevRangeOut.range.movementEnd
    }
  }

  const cacheKey = dashboardMetricsCacheKey({
    businessId,
    start: range.movementStart,
    end: range.movementEnd,
    positionAsOf: positionAsOfDate,
    compareStart,
    compareEnd,
  })

  let usedSummaryFastPath = false

  const { value: payload, source: cacheSource, cache_enabled: cacheEnabled } =
    await loadOrComputeDashboardMetrics(cacheKey, async () => {
      if (isDashboardPnlSummaryFastPathEnabled()) {
        const snapshotPayload = await buildMetricsFromSummarySnapshot(
          supabase,
          businessId,
          range,
          positionAsOfDate,
          compareStart,
          compareEnd
        )
        if (snapshotPayload) {
          usedSummaryFastPath = true
          return snapshotPayload
        }
      }

      const tRpc = performance.now()
      const { data: metricsRaw, error: rpcError } = await supabase.rpc(
        "get_service_dashboard_metrics",
        {
          p_business_id: businessId,
          p_start_date: range.movementStart,
          p_end_date: range.movementEnd,
          p_position_as_of_date: positionAsOfDate,
          p_compare_start_date: compareStart,
          p_compare_end_date: compareEnd,
        }
      )
      const msRpc = Math.round((performance.now() - tRpc) * 10) / 10

      if (rpcError) {
        const errorClass = classifySupabaseError(rpcError)
        logSupabaseRpcFailure(
          "dashboard_metrics",
          "get_service_dashboard_metrics",
          businessId,
          rpcError,
          msRpc,
          {
            error_class: errorClass,
            period_start: range.movementStart,
            period_end: range.movementEnd,
            position_as_of_date: positionAsOfDate,
            cache_enabled: isDashboardMetricsCacheEnabled(),
          }
        )
        const err = new Error(rpcError.message ?? "rpc_error") as Error & {
          rpcMeta?: RouteDiagFields
        }
        err.rpcMeta = {
          error_class: errorClass,
          error_code: rpcError.code ?? null,
          ms_rpc: msRpc,
        }
        throw err
      }

      const metrics = (metricsRaw ?? {}) as DashboardMetricsRpcResult
      const currencyCode = String(metrics.currency_code ?? "GHS")
      const currency = {
        code: currencyCode,
        symbol: getCurrencySymbol(currencyCode) || currencyCode,
        name: getCurrencyName(currencyCode) || currencyCode,
      }

      const built: ServiceDashboardMetricsPayload = {
        period: {
          period_id: range.period.period_id,
          period_start: range.movementStart,
          period_end: range.movementEnd,
          resolution_reason: range.period.resolution_reason,
        },
        currency,
        revenue: num(metrics.revenue),
        expenses: num(metrics.expenses),
        netProfit: num(metrics.net_profit),
        cashCollected: num(metrics.cash_collected),
        accountsReceivable: num(metrics.accounts_receivable),
        accountsPayable: num(metrics.accounts_payable),
        cashBalance: num(metrics.cash_balance),
        positionBalancesAsOfToday: true,
        positionAsOfDate,
        previousPeriod: null,
      }

      if (compareStart && compareEnd && metrics.previous_revenue !== undefined) {
        built.previousPeriod = {
          revenue: num(metrics.previous_revenue),
          expenses: num(metrics.previous_expenses),
          netProfit: num(metrics.previous_net_profit),
          cashCollected: num(metrics.previous_cash_collected),
          accountsReceivable: num(metrics.previous_accounts_receivable),
          accountsPayable: num(metrics.previous_accounts_payable),
          cashBalance: num(metrics.previous_cash_balance),
        }
      }

      return built
    })

  diag.step("metrics", {
    cache_enabled: cacheEnabled,
    cache_source: cacheSource,
    dashboard_pnl_source: dashboardPnlSourceForDiag(usedSummaryFastPath),
  })

  return payload
}
