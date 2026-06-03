/**
 * GET /api/dashboard/service-metrics?business_id=...
 *
 * Read-only. Returns ledger-derived metrics for Service workspace dashboard.
 * P&L metrics use getProfitAndLossReport (ledger movement); positions use cumulative ledger as-of today.
 * Optional: period_id, period_start (defaults to current period).
 */

import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { getBusinessToday } from "@/lib/accounting/businessDate"
import {
  getFinancialOverviewPositions,
} from "@/lib/accounting/reports/cumulativeBalanceSheet"
import {
  getProfitAndLossReport,
  pnlTotalsFromReport,
  type PnLReportResponse,
} from "@/lib/accounting/reports/getProfitAndLossReport"
const CASH_CODES = ["1000", "1010", "1020", "1030"] as const

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

    const pnlPromise = (async () => {
      const t0 = performance.now()
      const r = await getProfitAndLossReport(supabase, {
        businessId,
        period_id: periodId,
        period_start: periodStart,
      })
      devServiceMetricsLog("Profit & Loss calculation", t0)
      return r
    })()

    const positionAsOfPromise = (async () => {
      const t0 = performance.now()
      const asOf = await getBusinessToday(supabase, businessId)
      const r = await getFinancialOverviewPositions(supabase, businessId, asOf)
      devServiceMetricsLog("Financial overview (cumulative as-of today)", t0)
      return { ...r, asOf }
    })()

    const [pnlOut, positionsOut] = await Promise.all([pnlPromise, positionAsOfPromise])

    if (pnlOut.error || !pnlOut.data) {
      return finish(
        NextResponse.json(
          { error: pnlOut.error ?? "Could not resolve period or fetch P&L" },
          { status: 500 }
        )
      )
    }

    const pnl = pnlOut.data

    if (positionsOut.error || !positionsOut.data) {
      return finish(
        NextResponse.json(
          { error: positionsOut.error || "Could not fetch balance sheet positions" },
          { status: 500 }
        )
      )
    }

    const positions = positionsOut.data
    const positionAsOfDate = positionsOut.asOf

    const { revenue, expenses, netProfit } = pnlTotalsFromReport(pnl)
    const cashBalance = positions.cashBalance
    const ar = positions.accountsReceivable
    const ap = positions.accountsPayable

    const prevStartRaw = searchParams.get("previous_period_start")
    const prevStart = prevStartRaw?.trim() ? prevStartRaw : null

    const cashCollectedPromise = (async () => {
      const tCash = performance.now()
      let cashCollected = 0
      const pnlPeriodStart = (pnl.period as Record<string, unknown>)?.period_start as string | undefined
      const pnlPeriodEnd = (pnl.period as Record<string, unknown>)?.period_end as string | undefined

      if (pnlPeriodStart && pnlPeriodEnd) {
        const { data: cashAccounts } = await supabase
          .from("accounts")
          .select("id")
          .eq("business_id", businessId)
          .in("code", [...CASH_CODES])

        const cashAccountIds = (cashAccounts ?? []).map((a: { id: string }) => a.id)

        if (cashAccountIds.length > 0) {
          const { data: cashLines } = await supabase
            .from("journal_entry_lines")
            .select("debit, journal_entries!inner(date, business_id)")
            .in("account_id", cashAccountIds)
            .gte("journal_entries.date", pnlPeriodStart)
            .lte("journal_entries.date", pnlPeriodEnd)
            .eq("journal_entries.business_id", businessId)

          cashCollected = Math.round(
            (cashLines ?? []).reduce(
              (s: number, l: Record<string, unknown>) => s + (Number(l.debit) || 0),
              0
            ) * 100
          ) / 100
        }
      }
      devServiceMetricsLog("cash/journal aggregation", tCash)
      return cashCollected
    })()

    const previousPeriodPromise = (async (): Promise<PreviousPeriodPayload | null> => {
      if (!prevStart) return null
      const tPrev = performance.now()
      const pnlPrevRes = await getProfitAndLossReport(supabase, {
        businessId,
        period_start: prevStart,
      })
      devServiceMetricsLog("previous period P&L", tPrev)

      const pnlPrev = pnlPrevRes.data
      if (!pnlPrev) return null

      const prevEnd = (pnlPrev.period as Record<string, unknown>)?.period_end as string | undefined
      let prevPositions: {
        cashBalance: number
        accountsReceivable: number
        accountsPayable: number
      } | null = null
      if (prevEnd) {
        const posRes = await getFinancialOverviewPositions(supabase, businessId, prevEnd)
        if (posRes.data) prevPositions = posRes.data
      }

      const { revenue: revPrev, expenses: expPrev, netProfit: netProfitPrev } =
        pnlTotalsFromReport(pnlPrev)

      return {
        revenue: revPrev,
        expenses: expPrev,
        netProfit: netProfitPrev,
        cashCollected: 0,
        accountsReceivable: prevPositions?.accountsReceivable ?? null,
        accountsPayable: prevPositions?.accountsPayable ?? null,
        cashBalance: prevPositions?.cashBalance ?? null,
      }
    })()

    const tAsm = performance.now()
    const [cashCollected, previousPeriod] = await Promise.all([
      cashCollectedPromise,
      previousPeriodPromise,
    ])

    const payload = {
      period: pnl.period,
      currency: pnl.currency,
      revenue,
      expenses,
      netProfit,
      cashCollected,
      accountsReceivable: ar,
      accountsPayable: ap,
      cashBalance,
      positionBalancesAsOfToday: true,
      positionAsOfDate,
      previousPeriod: null as PreviousPeriodPayload | null,
    }
    if (previousPeriod) {
      payload.previousPeriod = previousPeriod
    }

    devServiceMetricsLog("final response assembly", tAsm)

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
