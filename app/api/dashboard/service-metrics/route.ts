/**
 * GET /api/dashboard/service-metrics?business_id=...
 *
 * Read-only. Returns ledger-derived metrics for Service workspace dashboard.
 *
 * Query flow (post consolidation):
 *   1. Auth + checkAccountingAuthority
 *   2. resolvePnLMovementRange (period_id / period_start params — lightweight)
 *   3. getBusinessToday (position as-of date)
 *   4. Optional previous period range when previous_period_start param set
 *   5. One RPC: get_service_dashboard_metrics
 *
 * Previous flow: parallel P&L + balance sheet, then cash RPC, then optional
 * second P&L + balance sheet for previous period comparison.
 */

import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { getBusinessToday } from "@/lib/accounting/businessDate"
import { resolvePnLMovementRange } from "@/lib/accounting/reports/resolvePnLMovementRange"
import { getCurrencyName, getCurrencySymbol } from "@/lib/currency"

function devServiceMetricsLog(label: string, startedAt: number) {
  if (process.env.NODE_ENV === "production") return
  console.info(`[service-metrics] ${label}: ${(performance.now() - startedAt).toFixed(1)}ms`)
}

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

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function num(v: unknown): number {
  return roundMoney(Number(v) || 0)
}

export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  const finish = (res: NextResponse) => {
    devServiceMetricsLog("total route", routeT0)
    return res
  }

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      devServiceMetricsLog("auth/business/access resolution", tAuth)
      return finish(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) {
      devServiceMetricsLog("auth/business/access resolution", tAuth)
      return finish(
        NextResponse.json({ error: "Missing required parameter: business_id" }, { status: 400 })
      )
    }

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      devServiceMetricsLog("auth/business/access resolution", tAuth)
      return finish(
        NextResponse.json({ error: "You do not have access to this business" }, { status: 403 })
      )
    }
    devServiceMetricsLog("auth/business/access resolution", tAuth)

    const periodId = searchParams.get("period_id") ?? undefined
    const periodStart = searchParams.get("period_start") ?? undefined

    const tPeriod = performance.now()
    const { range, error: rangeError } = await resolvePnLMovementRange(supabase, {
      businessId,
      period_id: periodId,
      period_start: periodStart,
    })
    devServiceMetricsLog("period resolution", tPeriod)

    if (rangeError || !range) {
      return finish(
        NextResponse.json(
          { error: rangeError ?? "Could not resolve period or fetch P&L" },
          { status: 500 }
        )
      )
    }

    const tPositionDate = performance.now()
    const positionAsOfDate = await getBusinessToday(supabase, businessId)
    devServiceMetricsLog("business today", tPositionDate)

    const prevStartRaw = searchParams.get("previous_period_start")
    const prevStart = prevStartRaw?.trim() ? prevStartRaw : null

    let compareStart: string | null = null
    let compareEnd: string | null = null

    if (prevStart) {
      const tPrevPeriod = performance.now()
      const prevRangeOut = await resolvePnLMovementRange(supabase, {
        businessId,
        period_start: prevStart,
      })
      devServiceMetricsLog("previous period resolution", tPrevPeriod)
      if (prevRangeOut.range) {
        compareStart = prevRangeOut.range.movementStart
        compareEnd = prevRangeOut.range.movementEnd
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
    devServiceMetricsLog("get_service_dashboard_metrics RPC", tRpc)

    if (rpcError) {
      console.error("get_service_dashboard_metrics RPC error:", rpcError)
      return finish(
        NextResponse.json({ error: "Could not load dashboard metrics" }, { status: 500 })
      )
    }

    const metrics = (metricsRaw ?? {}) as DashboardMetricsRpcResult
    const currencyCode = String(metrics.currency_code ?? "GHS")
    const currency = {
      code: currencyCode,
      symbol: getCurrencySymbol(currencyCode) || currencyCode,
      name: getCurrencyName(currencyCode) || currencyCode,
    }

    const payload = {
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
      previousPeriod: null as PreviousPeriodPayload | null,
    }

    if (compareStart && compareEnd && metrics.previous_revenue !== undefined) {
      payload.previousPeriod = {
        revenue: num(metrics.previous_revenue),
        expenses: num(metrics.previous_expenses),
        netProfit: num(metrics.previous_net_profit),
        cashCollected: num(metrics.previous_cash_collected),
        accountsReceivable: num(metrics.previous_accounts_receivable),
        accountsPayable: num(metrics.previous_accounts_payable),
        cashBalance: num(metrics.previous_cash_balance),
      }
    }

    return finish(NextResponse.json(payload))
  } catch (err) {
    console.error("Dashboard service-metrics error:", err)
    return finish(
      NextResponse.json(
        { error: err instanceof Error ? err.message : "Server error" },
        { status: 500 }
      )
    )
  }
}
