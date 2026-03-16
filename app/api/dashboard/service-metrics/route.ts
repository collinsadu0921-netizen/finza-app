/**
 * GET /api/dashboard/service-metrics?business_id=...
 *
 * Read-only. Returns ledger-derived metrics for Service workspace dashboard.
 * Uses existing P&L and Balance Sheet report logic; no schema or posting changes.
 * Optional: period_id, period_start (defaults to current period).
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { getProfitAndLossReport } from "@/lib/accounting/reports/getProfitAndLossReport"
import { getBalanceSheetReport } from "@/lib/accounting/reports/getBalanceSheetReport"

const CASH_CODES = ["1000", "1010", "1020", "1030"]
/** Accounts Receivable control account. Use 1100 (service/standard); 1200 is Inventory in retail. */
const AR_CODE = "1100"

function extractCash(bs: any): number {
  let sum = 0
  const assets = bs?.sections?.find((s: any) => s.key === "assets")
  if (!assets) return 0
  for (const g of assets.groups || []) {
    for (const line of g.lines || []) {
      if (CASH_CODES.includes(String(line.account_code).trim())) sum += Number(line.amount ?? 0)
    }
  }
  return Math.round(sum * 100) / 100
}

function extractAR(bs: any): number {
  const assets = bs?.sections?.find((s: any) => s.key === "assets")
  if (!assets) return 0
  for (const g of assets.groups || []) {
    for (const line of g.lines || []) {
      if (String(line.account_code).trim() === AR_CODE) return Math.round(Number(line.amount ?? 0) * 100) / 100
    }
  }
  return 0
}

function extractAP(bs: any): number {
  const liab = bs?.sections?.find((s: any) => s.key === "liabilities")
  if (!liab) return 0
  let sum = 0
  for (const g of liab.groups || []) {
    if (g.key === "current_liabilities") sum += Number(g.subtotal ?? 0)
  }
  return Math.round(sum * 100) / 100
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

    const periodId = searchParams.get("period_id") ?? undefined
    const periodStart = searchParams.get("period_start") ?? undefined

    const { data: pnl, error: pnlError } = await getProfitAndLossReport(supabase, {
      businessId,
      period_id: periodId,
      period_start: periodStart,
    })

    if (pnlError || !pnl) {
      return NextResponse.json(
        { error: pnlError ?? "Could not resolve period or fetch P&L" },
        { status: 500 }
      )
    }

    const { data: bs, error: bsError } = await getBalanceSheetReport(supabase, {
      businessId,
      period_id: periodId,
      period_start: periodStart,
    })

    if (bsError || !bs) {
      return NextResponse.json(
        { error: bsError ?? "Could not fetch balance sheet" },
        { status: 500 }
      )
    }

    const incomeSections = pnl.sections.filter((s) => s.key === "income" || s.key === "other_income")
    const expenseSections = pnl.sections.filter(
      (s) =>
        s.key === "cogs" ||
        s.key === "operating_expenses" ||
        s.key === "other_expenses" ||
        s.key === "taxes"
    )
    const revenue = Math.round(incomeSections.reduce((sum, s) => sum + s.subtotal, 0) * 100) / 100
    const expenses = Math.round(expenseSections.reduce((sum, s) => sum + s.subtotal, 0) * 100) / 100
    const netProfit = pnl.totals?.net_profit ?? revenue - expenses
    const cashBalance = extractCash(bs)
    const ar = extractAR(bs)
    const ap = extractAP(bs)

    const payload = {
      period: pnl.period,
      currency: pnl.currency,
      revenue,
      expenses,
      netProfit,
      accountsReceivable: ar,
      accountsPayable: ap,
      cashBalance,
      previousPeriod: null as {
        revenue: number
        expenses: number
        netProfit: number
        accountsReceivable: number
        accountsPayable: number
        cashBalance: number
      } | null,
    }

    const prevStart = searchParams.get("previous_period_start")
    if (prevStart) {
      const { data: pnlPrev } = await getProfitAndLossReport(supabase, {
        businessId,
        period_start: prevStart,
      })
      const { data: bsPrev } = await getBalanceSheetReport(supabase, {
        businessId,
        period_start: prevStart,
      })
      if (pnlPrev && bsPrev) {
        const revPrev = Math.round(
          pnlPrev.sections
            .filter((s) => s.key === "income" || s.key === "other_income")
            .reduce((sum, s) => sum + s.subtotal, 0) * 100
        ) / 100
        const expPrev = Math.round(
          pnlPrev.sections
            .filter(
              (s) =>
                s.key === "cogs" ||
                s.key === "operating_expenses" ||
                s.key === "other_expenses" ||
                s.key === "taxes"
            )
            .reduce((sum, s) => sum + s.subtotal, 0) * 100
        ) / 100
        payload.previousPeriod = {
          revenue: revPrev,
          expenses: expPrev,
          netProfit: pnlPrev.totals?.net_profit ?? revPrev - expPrev,
          accountsReceivable: extractAR(bsPrev),
          accountsPayable: extractAP(bsPrev),
          cashBalance: extractCash(bsPrev),
        }
      }
    }

    return NextResponse.json(payload)
  } catch (err) {
    console.error("Dashboard service-metrics error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    )
  }
}
