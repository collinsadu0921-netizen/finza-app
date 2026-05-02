/**
 * GET /api/dashboard/service-timeline?business_id=...&periods=6
 *
 * Read-only. Returns ledger-derived revenue/expense/profit per period for chart.
 * periods default 6. Uses get_profit_and_loss_from_trial_balance per period.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { getProfitAndLossReport } from "@/lib/accounting/reports/getProfitAndLossReport"
import type { SupabaseClient } from "@supabase/supabase-js"

/** Bounded parallel P&L fetches — fewer round-trips than sequential, avoids 12-at-once load. */
const TIMELINE_PNL_CONCURRENCY = 4

function devServiceTimelineLog(label: string, startedAt: number) {
  if (process.env.NODE_ENV === "production") return
  console.info(`[service-timeline] ${label}: ${(performance.now() - startedAt).toFixed(1)}ms`)
}

async function getPnLTotals(
  supabase: SupabaseClient,
  businessId: string,
  periodStart: string
): Promise<{ revenue: number; expenses: number; netProfit: number } | null> {
  const { data } = await getProfitAndLossReport(supabase, {
    businessId,
    period_start: periodStart,
  })
  if (!data) return null
  const incomeSections = data.sections.filter((s) => s.key === "income" || s.key === "other_income")
  const expenseSections = data.sections.filter(
    (s) =>
      s.key === "cogs" ||
      s.key === "operating_expenses" ||
      s.key === "other_expenses" ||
      s.key === "taxes"
  )
  const revenue = Math.round(incomeSections.reduce((sum, s) => sum + s.subtotal, 0) * 100) / 100
  const expenses = Math.round(expenseSections.reduce((sum, s) => sum + s.subtotal, 0) * 100) / 100
  const netProfit = data.totals?.net_profit ?? revenue - expenses
  return { revenue, expenses, netProfit }
}

/**
 * Run async work on items in original index order; at most `concurrency` mappers run at once.
 * Results array aligns with `items` indices (preserves output order for downstream iteration).
 */
async function mapOrderedWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const limit = Math.max(1, Math.min(concurrency, items.length))

  async function worker() {
    while (true) {
      const i = nextIndex++
      if (i >= items.length) break
      results[i] = await mapper(items[i], i)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}

export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      devServiceTimelineLog("auth/access", tAuth)
      devServiceTimelineLog("total route", routeT0)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) {
      devServiceTimelineLog("auth/access", tAuth)
      devServiceTimelineLog("total route", routeT0)
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      devServiceTimelineLog("auth/access", tAuth)
      devServiceTimelineLog("total route", routeT0)
      return NextResponse.json(
        { error: "You do not have access to this business" },
        { status: 403 }
      )
    }
    devServiceTimelineLog("auth/access", tAuth)

    const periodsParam = Math.min(24, Math.max(1, parseInt(searchParams.get("periods") ?? "6", 10) || 6))

    const tPeriods = performance.now()
    const { data: periodRows } = await supabase
      .from("accounting_periods")
      .select("id, period_start, period_end")
      .eq("business_id", businessId)
      .order("period_start", { ascending: false })
      .limit(periodsParam)
    devServiceTimelineLog("accounting_periods query", tPeriods)

    const timeline: Array<{
      period_id: string
      period_start: string
      period_end: string
      revenue: number
      expenses: number
      netProfit: number
    }> = []

    if (periodRows?.length) {
      const orderedRows = [...periodRows].reverse()
      const tPnLLoop = performance.now()
      const rowResults = await mapOrderedWithConcurrency(
        orderedRows,
        TIMELINE_PNL_CONCURRENCY,
        async (row) => {
          const totals = await getPnLTotals(supabase, businessId, row.period_start)
          return { row, totals }
        }
      )
      devServiceTimelineLog("P&L loop total", tPnLLoop)

      const tAsm = performance.now()
      for (const { row, totals } of rowResults) {
        if (totals) {
          timeline.push({
            period_id: row.id,
            period_start: row.period_start,
            period_end: row.period_end,
            revenue: totals.revenue,
            expenses: totals.expenses,
            netProfit: totals.netProfit,
          })
        }
      }
      devServiceTimelineLog("response assembly", tAsm)
    }

    devServiceTimelineLog("total route", routeT0)
    return NextResponse.json({ timeline })
  } catch (err) {
    devServiceTimelineLog("total route", routeT0)
    console.error("Dashboard service-timeline error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    )
  }
}
