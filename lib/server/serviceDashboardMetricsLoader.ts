/**
 * Shared service dashboard metrics payload loader.
 */

import type { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getBusinessToday } from "@/lib/accounting/businessDate"
import { resolvePnLMovementRange, type PnLMovementRange } from "@/lib/accounting/reports/resolvePnLMovementRange"
import { getCurrencyName, getCurrencySymbol } from "@/lib/currency"
import {
  dashboardMetricsCacheKey,
  isDashboardMetricsCacheEnabled,
  loadOrComputeDashboardMetrics,
} from "@/lib/server/dashboardMetricsCache"
import {
  dashboardFinancialSourceForDiag,
  dashboardPnlSourceForDiag,
} from "@/lib/server/dashboardPeriodSummaryRead"
import { SUMMARY_FRESH_SECONDS } from "@/lib/server/serviceDashboardTimeline"
import {
  enqueueAndScheduleTargetedSnapshotRefresh,
  periodHasLivePnlMovement,
} from "@/lib/server/accountingSnapshotRefresh"
import { loadCustomerPaymentsCollectedTotal } from "@/lib/server/customerPaymentsCollected"
import { classifySupabaseError, logSupabaseRpcFailure } from "@/lib/server/logSupabaseRpcError"
import {
  EMPTY_OPERATIONAL_UNPAID_INVOICES,
  loadOperationalUnpaidInvoicesSummary,
  type OperationalUnpaidInvoicesSummary,
} from "@/lib/server/operationalUnpaidInvoicesLoader"
import type { RouteDiagFields } from "@/lib/server/routeDiagnostics"
import type { createRouteDiag } from "@/lib/server/routeDiagnostics"
import {
  dashboardLiveFallbackTimeoutMs,
  loadLivePeriodPnlFromLedger,
} from "@/lib/server/dashboardMetricsLedgerFallback"

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

export type DashboardSnapshotStatus = "fresh" | "stale" | "missing" | "live_fallback"

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
  /** Operational outstanding across unpaid invoices (not ledger AR). */
  unpaidInvoicesTotal: number
  unpaidInvoicesCount: number
  overdueInvoicesTotal: number
  overdueInvoicesCount: number
  /** False when period P&L projection is missing — UI must not render period KPIs as zero. */
  metrics_ready?: boolean
  /** False when ledger position balances could not be loaded. */
  positions_ready?: boolean
  metrics_source?: ServiceDashboardMetricsLoadMeta["source"]
  positions_source?: "live" | "summary" | "missing"
  snapshot_status?: DashboardSnapshotStatus
  /** True when period KPIs were computed from ledger because snapshot was missing. */
  live_fallback_used?: boolean
  live_fallback_timeout?: boolean
  live_fallback_error?: string
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function num(v: unknown): number {
  return roundMoney(Number(v) || 0)
}

function withOperationalUnpaidFields(
  payload: Omit<
    ServiceDashboardMetricsPayload,
    keyof OperationalUnpaidInvoicesSummary
  >,
  summary: OperationalUnpaidInvoicesSummary
): ServiceDashboardMetricsPayload {
  return { ...payload, ...summary }
}

function emptyOperationalFields(): OperationalUnpaidInvoicesSummary {
  return { ...EMPTY_OPERATIONAL_UNPAID_INVOICES }
}

export type ServiceDashboardMetricsParams = {
  periodId?: string
  periodStart?: string
  previousPeriodStart?: string
}

export type ServiceDashboardMetricsLoadOptions = {
  /** When false, summary reads only — no live get_service_dashboard_metrics RPC. */
  refreshOnRequest?: boolean
  scheduleBackground?: (promise: Promise<unknown>) => void
}

export type ServiceDashboardMetricsLoadMeta = {
  source: "summary" | "live" | "degraded" | "ledger_live_fallback"
}

export type SummaryMetricsMissReason =
  | "missing_row"
  | "compare_period_missing"
  | "rpc_error"
  | "unknown"

type SummarySnapshotBuildResult =
  | { ok: true; payload: ServiceDashboardMetricsPayload }
  | { ok: false; reason: SummaryMetricsMissReason }

type PeriodPnlSummaryReadResult = {
  row: {
    revenue: number | string
    expenses: number | string
    net_profit: number | string
    refreshed_at: string
  } | null
  reason?: SummaryMetricsMissReason
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
  asOfDate: string,
  options?: { throwOnError?: boolean }
): Promise<PositionRow> {
  const { data, error } = await supabase.rpc("finza_dashboard_positions_as_of", {
    p_business_id: businessId,
    p_as_of_date: asOfDate,
  })
  if (error) {
    if (options?.throwOnError === false) {
      console.warn("[dashboard-metrics] positions read failed:", error.message)
      return {}
    }
    throw error
  }
  const row = Array.isArray(data) ? data[0] : data
  return (row ?? {}) as PositionRow
}

async function loadCashCollected(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  options?: { throwOnError?: boolean }
): Promise<number> {
  return loadCustomerPaymentsCollectedTotal(
    supabase,
    businessId,
    startDate,
    endDate,
    options
  )
}

async function readPeriodPnlSummaryRow(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  _options?: { allowStalePnl?: boolean }
): Promise<PeriodPnlSummaryReadResult> {
  // Fresh only — invalidated/stale summaries are not authoritative financial truth.
  void _options
  const { data: freshData, error: freshError } = await supabase.rpc(
    "get_fresh_service_dashboard_period_pnl",
    {
      p_business_id: businessId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_max_stale_seconds: SUMMARY_FRESH_SECONDS,
    }
  )

  if (freshError) {
    console.warn("[dashboard-period-pnl] fresh summary read failed:", freshError.message)
    return { row: null, reason: "rpc_error" }
  }

  const freshRow = Array.isArray(freshData) ? freshData[0] : freshData
  if (freshRow && typeof freshRow === "object") {
    return { row: freshRow as PeriodPnlSummaryReadResult["row"] }
  }

  return { row: null, reason: "missing_row" }
}

function ensureDashboardRefreshScheduled(
  supabase: SupabaseClient,
  businessId: string,
  periodStart: string,
  periodEnd: string,
  scheduleBackground?: (promise: Promise<unknown>) => void
): void {
  const work = enqueueAndScheduleTargetedSnapshotRefresh(supabase, {
    businessId,
    periodStart,
    periodEnd,
    jobType: "both",
    reason: "read_path_missing_snapshot",
    sourceType: "dashboard_metrics",
    triggerSource: "stale_dashboard_read",
  })
  if (scheduleBackground) {
    try {
      scheduleBackground(work)
      return
    } catch {
      // fall through
    }
  }
  console.warn("[dashboard-metrics] snapshot refresh scheduled without request-owned waitUntil", {
    business_id: businessId,
    period_start: periodStart,
    period_end: periodEnd,
  })
  void work
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
  compareEnd: string | null,
  options?: { allowStalePnl?: boolean; softPositionReads?: boolean }
): Promise<SummarySnapshotBuildResult> {
  const currentPnl = await readPeriodPnlSummaryRow(
    supabase,
    businessId,
    range.movementStart,
    range.movementEnd,
    { allowStalePnl: options?.allowStalePnl }
  )
  if (!currentPnl.row) {
    return { ok: false, reason: currentPnl.reason ?? "missing_row" }
  }
  const freshPnl = currentPnl.row

  const softReads = options?.softPositionReads === true

  // Missing compare-period summary must not force current-period onto live RPC.
  // Soft-omit previousPeriod when comparison data is unavailable.
  let previousPeriod: PreviousPeriodPayload | null = null
  if (compareStart && compareEnd) {
    const prevPnlRead = await readPeriodPnlSummaryRow(
      supabase,
      businessId,
      compareStart,
      compareEnd,
      { allowStalePnl: options?.allowStalePnl }
    )
    if (prevPnlRead.row) {
      const prevPnl = prevPnlRead.row
      const [prevPositions, prevCash] = await Promise.all([
        loadPositionsAsOf(supabase, businessId, compareEnd, { throwOnError: !softReads }),
        loadCashCollected(supabase, businessId, compareStart, compareEnd, {
          throwOnError: !softReads,
        }),
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
  }

  const [currency, positions, cashCollected] = await Promise.all([
    loadBusinessCurrency(supabase, businessId),
    loadPositionsAsOf(supabase, businessId, positionAsOfDate, { throwOnError: !softReads }),
    loadCashCollected(supabase, businessId, range.movementStart, range.movementEnd, {
      throwOnError: !softReads,
    }),
  ])

  return {
    ok: true,
    payload: withOperationalUnpaidFields(
      {
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
        metrics_ready: true,
        positions_ready: true,
        metrics_source: "summary",
        positions_source: "live",
        snapshot_status: "fresh",
      },
      emptyOperationalFields()
    ),
  }
}

function positionsPayloadReady(positions: PositionRow): boolean {
  return (
    positions.cash_balance !== undefined ||
    positions.accounts_receivable !== undefined ||
    positions.accounts_payable !== undefined
  )
}

/**
 * Missing/stale period snapshot — never emit fake zero financial KPIs as ready.
 * Loads live ledger positions when available; period P&L left not-ready for UI.
 */
async function buildMissingSnapshotMetricsPayload(
  supabase: SupabaseClient,
  businessId: string,
  range: PnLMovementRange | null,
  positionAsOfDate: string,
  options?: {
    resolutionReason?: string
    liveFallbackTimedOut?: boolean
    liveFallbackError?: string
  }
): Promise<ServiceDashboardMetricsPayload> {
  const currency = await loadBusinessCurrency(supabase, businessId)
  const periodStart = range?.movementStart ?? positionAsOfDate
  const periodEnd = range?.movementEnd ?? positionAsOfDate
  const positions = await loadPositionsAsOf(supabase, businessId, positionAsOfDate, {
    throwOnError: false,
  })
  const positionsReady = positionsPayloadReady(positions)

  return withOperationalUnpaidFields(
    {
      period: {
        period_id: range?.period.period_id,
        period_start: periodStart,
        period_end: periodEnd,
        resolution_reason:
          options?.resolutionReason ?? range?.period.resolution_reason ?? "degraded",
      },
      currency,
      revenue: 0,
      expenses: 0,
      netProfit: 0,
      cashCollected: 0,
      accountsReceivable: positionsReady ? num(positions.accounts_receivable) : 0,
      accountsPayable: positionsReady ? num(positions.accounts_payable) : 0,
      cashBalance: positionsReady ? num(positions.cash_balance) : 0,
      positionBalancesAsOfToday: true,
      positionAsOfDate,
      previousPeriod: null,
      metrics_ready: false,
      positions_ready: positionsReady,
      metrics_source: "degraded",
      positions_source: positionsReady ? "live" : "missing",
      snapshot_status: "missing",
      live_fallback_used: false,
      live_fallback_timeout: options?.liveFallbackTimedOut === true,
      ...(options?.liveFallbackError ? { live_fallback_error: options.liveFallbackError } : {}),
    },
    emptyOperationalFields()
  )
}

type LiveLedgerMetricsBuildResult =
  | { ok: true; payload: ServiceDashboardMetricsPayload }
  | { ok: false; timedOut: boolean; error?: string }

/**
 * Bounded ledger fallback when period summary projection is missing.
 * Uses finza_dashboard_pnl_totals — same source as P&L reports.
 */
async function buildMetricsFromLiveLedgerFallback(
  supabase: SupabaseClient,
  businessId: string,
  range: {
    movementStart: string
    movementEnd: string
    period: { period_id: string; resolution_reason?: string }
  },
  positionAsOfDate: string,
  options?: { softPositionReads?: boolean }
): Promise<LiveLedgerMetricsBuildResult> {
  const timeoutMs = dashboardLiveFallbackTimeoutMs()
  const pnlRead = await loadLivePeriodPnlFromLedger(
    supabase,
    businessId,
    range.movementStart,
    range.movementEnd,
    timeoutMs
  )
  if (!pnlRead.row) {
    return {
      ok: false,
      timedOut: pnlRead.timedOut,
      error: pnlRead.error,
    }
  }

  const softReads = options?.softPositionReads === true
  const [currency, positions, cashCollected] = await Promise.all([
    loadBusinessCurrency(supabase, businessId),
    loadPositionsAsOf(supabase, businessId, positionAsOfDate, { throwOnError: !softReads }),
    loadCashCollected(supabase, businessId, range.movementStart, range.movementEnd, {
      throwOnError: !softReads,
    }),
  ])
  const positionsReady = positionsPayloadReady(positions)

  return {
    ok: true,
    payload: withOperationalUnpaidFields(
      {
        period: {
          period_id: range.period.period_id,
          period_start: range.movementStart,
          period_end: range.movementEnd,
          resolution_reason: range.period.resolution_reason,
        },
        currency,
        revenue: pnlRead.row.revenue,
        expenses: pnlRead.row.expenses,
        netProfit: pnlRead.row.net_profit,
        cashCollected,
        accountsReceivable: positionsReady ? num(positions.accounts_receivable) : 0,
        accountsPayable: positionsReady ? num(positions.accounts_payable) : 0,
        cashBalance: positionsReady ? num(positions.cash_balance) : 0,
        positionBalancesAsOfToday: true,
        positionAsOfDate,
        previousPeriod: null,
        metrics_ready: true,
        positions_ready: positionsReady,
        metrics_source: "ledger_live_fallback",
        positions_source: positionsReady ? "live" : "missing",
        snapshot_status: "live_fallback",
        live_fallback_used: true,
        live_fallback_timeout: false,
      },
      emptyOperationalFields()
    ),
  }
}

export async function loadServiceDashboardMetrics(
  supabase: SupabaseClient,
  businessId: string,
  params: ServiceDashboardMetricsParams,
  diag: RouteDiag,
  options?: ServiceDashboardMetricsLoadOptions,
  loadMeta?: ServiceDashboardMetricsLoadMeta
): Promise<ServiceDashboardMetricsPayload> {
  const summaryOnly = options?.refreshOnRequest === false
  const { range, error: rangeError } = await resolvePnLMovementRange(supabase, {
    businessId,
    period_id: params.periodId,
    period_start: params.periodStart,
  })

  const positionAsOfDate = await getBusinessToday(supabase, businessId)
  diag.step("business_today", { position_as_of_date: positionAsOfDate })

  if (rangeError || !range) {
    if (summaryOnly) {
      const degraded = await buildMissingSnapshotMetricsPayload(
        supabase,
        businessId,
        null,
        positionAsOfDate
      )
      loadMeta && (loadMeta.source = "degraded")
      diag.step("metrics", {
        metrics_source: "degraded",
        metrics_ready: false,
        snapshot_status: "missing",
        refresh_skipped: true,
        period_resolution_error: rangeError ?? "missing_range",
      })
      return degraded
    }
    throw new Error(rangeError ?? "Could not resolve period or fetch P&L")
  }

  diag.step("period_resolution", {
    period_start: range.movementStart,
    period_end: range.movementEnd,
  })

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
  let usedDegradedSummaryMissing = false
  let usedLiveLedgerFallback = false
  let summaryMissReason: SummaryMetricsMissReason | undefined
  let liveFallbackTimedOut = false
  let liveFallbackError: string | undefined

  const { value: payload, source: cacheSource, cache_enabled: cacheEnabled } =
    await loadOrComputeDashboardMetrics(cacheKey, async () => {
      const summaryOptions = {
        allowStalePnl: summaryOnly,
        softPositionReads: summaryOnly,
      }

      // Fresh current-period summary is the default financial KPI source
      // (not gated on FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH).
      const snapshotResult = await buildMetricsFromSummarySnapshot(
        supabase,
        businessId,
        range,
        positionAsOfDate,
        compareStart,
        compareEnd,
        summaryOptions
      )
      if (snapshotResult.ok) {
        usedSummaryFastPath = true
        return snapshotResult.payload
      }

      summaryMissReason = snapshotResult.reason

      // Invalidated/missing current-period summary → bounded ledger live fallback.
      const liveFallback = await buildMetricsFromLiveLedgerFallback(
        supabase,
        businessId,
        range,
        positionAsOfDate,
        { softPositionReads: true }
      )
      if (liveFallback.ok) {
        usedLiveLedgerFallback = true
        ensureDashboardRefreshScheduled(
          supabase,
          businessId,
          range.movementStart,
          range.movementEnd,
          options?.scheduleBackground
        )
        return liveFallback.payload
      }
      liveFallbackTimedOut = liveFallback.timedOut
      liveFallbackError = liveFallback.error

      if (summaryOnly) {
        const hasLiveMovement = await periodHasLivePnlMovement(
          supabase,
          businessId,
          range.movementStart,
          range.movementEnd
        )
        if (hasLiveMovement) {
          ensureDashboardRefreshScheduled(
            supabase,
            businessId,
            range.movementStart,
            range.movementEnd,
            options?.scheduleBackground
          )
        }
        usedDegradedSummaryMissing = true
        return buildMissingSnapshotMetricsPayload(supabase, businessId, range, positionAsOfDate, {
          resolutionReason: "degraded",
          liveFallbackTimedOut,
          liveFallbackError,
        })
      }

      // Last resort (refresh-on-request): heavy metrics RPC — never label as fresh.
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

      ensureDashboardRefreshScheduled(
        supabase,
        businessId,
        range.movementStart,
        range.movementEnd,
        options?.scheduleBackground
      )

      const metrics = (metricsRaw ?? {}) as DashboardMetricsRpcResult
      const currencyCode = String(metrics.currency_code ?? "GHS")
      const currency = {
        code: currencyCode,
        symbol: getCurrencySymbol(currencyCode) || currencyCode,
        name: getCurrencyName(currencyCode) || currencyCode,
      }

      const [cashCollected, previousCashCollected] = await Promise.all([
        loadCashCollected(supabase, businessId, range.movementStart, range.movementEnd, {
          throwOnError: true,
        }),
        compareStart && compareEnd
          ? loadCashCollected(supabase, businessId, compareStart, compareEnd, {
              throwOnError: true,
            })
          : Promise.resolve(null),
      ])

      const built = withOperationalUnpaidFields(
        {
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
          cashCollected,
          accountsReceivable: num(metrics.accounts_receivable),
          accountsPayable: num(metrics.accounts_payable),
          cashBalance: num(metrics.cash_balance),
          positionBalancesAsOfToday: true,
          positionAsOfDate,
          previousPeriod: null,
          metrics_ready: true,
          positions_ready: true,
          metrics_source: "live",
          positions_source: "live",
          snapshot_status: "live_fallback",
          live_fallback_used: true,
        },
        emptyOperationalFields()
      )

      if (compareStart && compareEnd && metrics.previous_revenue !== undefined) {
        built.previousPeriod = {
          revenue: num(metrics.previous_revenue),
          expenses: num(metrics.previous_expenses),
          netProfit: num(metrics.previous_net_profit),
          cashCollected: previousCashCollected ?? 0,
          accountsReceivable: num(metrics.previous_accounts_receivable),
          accountsPayable: num(metrics.previous_accounts_payable),
          cashBalance: num(metrics.previous_cash_balance),
        }
      }

      return built
    })

  const metricsSource: ServiceDashboardMetricsLoadMeta["source"] = usedLiveLedgerFallback
    ? "ledger_live_fallback"
    : usedDegradedSummaryMissing
      ? "degraded"
      : usedSummaryFastPath
        ? "summary"
        : "live"

  if (loadMeta) {
    loadMeta.source = metricsSource
  }

  const cacheHit = cacheSource === "cache_hit" || cacheSource === "cache_coalesce"

  diag.step("metrics", {
    cache_enabled: cacheEnabled,
    cache_source: cacheSource,
    dashboard_pnl_source: usedLiveLedgerFallback
      ? "ledger_live_fallback"
      : usedDegradedSummaryMissing
        ? "degraded"
        : dashboardPnlSourceForDiag(usedSummaryFastPath),
    dashboard_financial_source: dashboardFinancialSourceForDiag({
      cacheHit,
      usedSummaryFastPath,
      usedLiveFallback: usedLiveLedgerFallback || (!usedSummaryFastPath && !usedDegradedSummaryMissing),
    }),
    metrics_source: usedLiveLedgerFallback
      ? "ledger_live_fallback"
      : usedDegradedSummaryMissing
        ? "degraded_summary_missing"
        : metricsSource,
    metrics_ready: payload.metrics_ready !== false,
    snapshot_status:
      payload.snapshot_status ??
      (usedLiveLedgerFallback
        ? "live_fallback"
        : usedDegradedSummaryMissing
          ? "missing"
          : usedSummaryFastPath
            ? "fresh"
            : "live_fallback"),
    positions_source: payload.positions_source,
    live_fallback_used: payload.live_fallback_used === true,
    ...(liveFallbackTimedOut ? { live_fallback_timeout: true } : {}),
    ...(liveFallbackError ? { live_fallback_error: liveFallbackError } : {}),
    ...(summaryMissReason ? { summary_metrics_miss_reason: summaryMissReason } : {}),
    ...(summaryOnly && !usedSummaryFastPath && !usedLiveLedgerFallback
      ? { live_metrics_fallback_skipped: true }
      : {}),
    ...(usedDegradedSummaryMissing ? { degraded_metrics: true } : {}),
    ...(summaryOnly ? { refresh_skipped: true } : {}),
  })

  const operationalSummary = await loadOperationalUnpaidInvoicesSummary(supabase, businessId, {
    softFail: summaryOnly,
  })
  diag.step("operational_unpaid_invoices", {
    unpaid_count: operationalSummary.unpaidInvoicesCount,
    overdue_count: operationalSummary.overdueInvoicesCount,
  })

  return withOperationalUnpaidFields(payload, operationalSummary)
}
