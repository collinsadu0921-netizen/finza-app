/**
 * GET /api/dashboard/service-timeline?business_id=...&periods=6
 *
 * Read-only. Returns ledger-derived revenue/expense/profit per accounting period for chart.
 *
 * Query flow (post consolidation):
 *   1. Auth + checkAccountingAuthority
 *   2. One RPC: get_service_dashboard_timeline (replaces N× getProfitAndLossReport)
 *
 * Previous flow (removed): accounting_periods query + up to 24 parallel P&L RPCs.
 *
 * Response shape (unchanged for ServiceDashboardCockpit / FinancialFlowChart):
 *   { timeline: [{ period_id, period_start, period_end, revenue, expenses, netProfit }] }
 *
 * Params:
 *   - business_id (required)
 *   - periods (optional, default 6, max 24) — number of accounting periods
 */

import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

const DEFAULT_PERIODS = 6
const MAX_PERIODS = 24

function devServiceTimelineLog(label: string, startedAt: number) {
  if (process.env.NODE_ENV === "production") return
  console.info(`[service-timeline] ${label}: ${(performance.now() - startedAt).toFixed(1)}ms`)
}

type TimelineRpcRow = {
  period_id: string | null
  period_start: string
  period_end: string
  revenue: number | string
  expenses: number | string
  net_profit: number | string
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

    const periodsRaw = parseInt(searchParams.get("periods") ?? String(DEFAULT_PERIODS), 10)
    const periodsParam = Math.min(
      MAX_PERIODS,
      Math.max(1, Number.isFinite(periodsRaw) ? periodsRaw : DEFAULT_PERIODS)
    )

    const tRpc = performance.now()
    const { data: rows, error: rpcError } = await supabase.rpc("get_service_dashboard_timeline", {
      p_business_id: businessId,
      p_start_date: null,
      p_end_date: null,
      p_granularity: "accounting_period",
      p_periods_limit: periodsParam,
    })
    devServiceTimelineLog("get_service_dashboard_timeline RPC", tRpc)

    if (rpcError) {
      console.error("get_service_dashboard_timeline RPC error:", rpcError)
      devServiceTimelineLog("total route", routeT0)
      return NextResponse.json(
        { error: "Could not load dashboard timeline" },
        { status: 500 }
      )
    }

    const timeline = ((rows ?? []) as TimelineRpcRow[]).map((row) => ({
      period_id: row.period_id ?? undefined,
      period_start: row.period_start,
      period_end: row.period_end,
      revenue: Number(row.revenue) || 0,
      expenses: Number(row.expenses) || 0,
      netProfit: Number(row.net_profit) || 0,
    }))

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
