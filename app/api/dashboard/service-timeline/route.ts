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

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "You do not have access to this business" },
        { status: 403 }
      )
    }

    const periodsParam = Math.min(24, Math.max(1, parseInt(searchParams.get("periods") ?? "6", 10) || 6))

    const { data: periodRows } = await supabase
      .from("accounting_periods")
      .select("id, period_start, period_end")
      .eq("business_id", businessId)
      .order("period_start", { ascending: false })
      .limit(periodsParam)

    const timeline: Array<{
      period_id: string
      period_start: string
      period_end: string
      revenue: number
      expenses: number
      netProfit: number
    }> = []

    if (periodRows?.length) {
      for (const row of periodRows.reverse()) {
        const start = row.period_start
        const totals = await getPnLTotals(supabase, businessId, start)
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
    }

    return NextResponse.json({ timeline })
  } catch (err) {
    console.error("Dashboard service-timeline error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    )
  }
}
