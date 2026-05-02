/**
 * GET /api/dashboard/service-analytics?business_id=...&start_date=...&end_date=...&interval=day|week|month
 *
 * Service Financial Flow v2: timeseries from ledger only (journal_entries + journal_entry_lines + accounts).
 * Does NOT use trial_balance_snapshots or accounting report APIs.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

const DEFAULT_DAYS = 365
const VALID_INTERVALS = ["day", "week", "month"] as const

function devServiceAnalyticsLog(label: string, startedAt: number) {
  if (process.env.NODE_ENV === "production") return
  console.info(`[service-analytics] ${label}: ${(performance.now() - startedAt).toFixed(1)}ms`)
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
      devServiceAnalyticsLog("auth/access", tAuth)
      devServiceAnalyticsLog("total route", routeT0)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) {
      devServiceAnalyticsLog("auth/access", tAuth)
      devServiceAnalyticsLog("total route", routeT0)
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      devServiceAnalyticsLog("auth/access", tAuth)
      devServiceAnalyticsLog("total route", routeT0)
      return NextResponse.json(
        { error: "You do not have access to this business" },
        { status: 403 }
      )
    }
    devServiceAnalyticsLog("auth/access", tAuth)

    const rawInterval = (searchParams.get("interval") ?? "day").toLowerCase().trim()
    const interval = VALID_INTERVALS.includes(rawInterval as (typeof VALID_INTERVALS)[number])
      ? rawInterval
      : "day"

    let startDate = searchParams.get("start_date")
    let endDate = searchParams.get("end_date")

    if (!startDate || !endDate) {
      const end = endDate ? new Date(endDate) : new Date()
      const start = startDate ? new Date(startDate) : new Date(end)
      if (!startDate) {
        start.setDate(start.getDate() - DEFAULT_DAYS)
        startDate = start.toISOString().split("T")[0]
      }
      if (!endDate) {
        endDate = end.toISOString().split("T")[0]
      }
    }

    const tRpc = performance.now()
    const { data: rows, error } = await supabase.rpc("get_service_analytics_timeline", {
      p_business_id: businessId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_interval: interval,
    })
    devServiceAnalyticsLog("get_service_analytics_timeline RPC", tRpc)

    if (error) {
      console.error("Service analytics RPC error:", error)
      devServiceAnalyticsLog("total route", routeT0)
      return NextResponse.json(
        { error: error.message ?? "Failed to load analytics" },
        { status: 500 }
      )
    }

    const tAsm = performance.now()
    const timeline = (rows ?? []).map((r: any) => ({
      period_start: r.period_start,
      period_end: r.period_end,
      revenue: Number(r.revenue ?? 0),
      expenses: Number(r.expenses ?? 0),
      netProfit: Number(r.net_profit ?? 0),
      cashMovement: Number(r.cash_movement ?? 0),
    }))
    devServiceAnalyticsLog("response assembly", tAsm)

    devServiceAnalyticsLog("total route", routeT0)
    return NextResponse.json({ timeline })
  } catch (err) {
    devServiceAnalyticsLog("total route", routeT0)
    console.error("Dashboard service-analytics error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    )
  }
}
