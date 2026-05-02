/**
 * GET /api/dashboard/service-metrics?business_id=...
 *
 * Read-only. Returns ledger-derived metrics for Service workspace dashboard.
 * Uses existing P&L and Balance Sheet report logic; no schema or posting changes.
 * Optional: period_id, period_start (defaults to current period).
 *
 * QuickBooks-style split: when period_id / period_start is explicitly set, Revenue,
 * Expenses, Net profit, and Cash collected follow that period; Cash balance, AR, and AP
 * use the balance sheet as of today so position cards stay “live” while browsing history.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import {
  getProfitAndLossReport,
  type PnLReportResponse,
} from "@/lib/accounting/reports/getProfitAndLossReport"
import {
  getBalanceSheetReport,
  type BalanceSheetReportResponse,
} from "@/lib/accounting/reports/getBalanceSheetReport"

const CASH_CODES = ["1000", "1010", "1020", "1030"] as const
const CASH_CODE_SET = new Set<string>(CASH_CODES)
/** Accounts Receivable control account. Use 1100 (service/standard); 1200 is Inventory in retail. */
const AR_CODE = "1100"

function extractCash(bs: any): number {
  let sum = 0
  const assets = bs?.sections?.find((s: any) => s.key === "assets")
  if (!assets) return 0
  for (const g of assets.groups || []) {
    for (const line of g.lines || []) {
      if (CASH_CODE_SET.has(String(line.account_code).trim())) sum += Number(line.amount ?? 0)
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
    const explicitPeriod =
      Boolean(periodId?.trim()) || Boolean(periodStart?.trim())

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

    /** Position metrics: live as-of today when user picked a historical report period. */
    const todayUtc = new Date().toISOString().slice(0, 10)
    let bsPositions: BalanceSheetReportResponse | null = null
    let bsError = ""
    let pnl: PnLReportResponse | null = null

    if (explicitPeriod) {
      const bsLivePromise = (async () => {
        const t0 = performance.now()
        const r = await getBalanceSheetReport(supabase, {
          businessId,
          as_of_date: todayUtc,
        })
        devServiceMetricsLog("Balance Sheet calculation (as-of today)", t0)
        return r
      })()

      const [pnlOut, liveBs] = await Promise.all([pnlPromise, bsLivePromise])

      if (pnlOut.error || !pnlOut.data) {
        return finish(
          NextResponse.json(
            { error: pnlOut.error ?? "Could not resolve period or fetch P&L" },
            { status: 500 }
          )
        )
      }
      pnl = pnlOut.data

      bsPositions = liveBs.data
      bsError = liveBs.error
      if (!bsPositions) {
        const tFb = performance.now()
        const fallback = await getBalanceSheetReport(supabase, {
          businessId,
          period_id: periodId,
          period_start: periodStart,
        })
        devServiceMetricsLog("Balance Sheet calculation (fallback aligned period)", tFb)
        bsPositions = fallback.data
        bsError = fallback.error
      }
    } else {
      const bsAlignedPromise = (async () => {
        const t0 = performance.now()
        const r = await getBalanceSheetReport(supabase, {
          businessId,
          period_id: periodId,
          period_start: periodStart,
        })
        devServiceMetricsLog("Balance Sheet calculation (period-aligned)", t0)
        return r
      })()

      const [pnlOut, bsRes] = await Promise.all([pnlPromise, bsAlignedPromise])

      if (pnlOut.error || !pnlOut.data) {
        return finish(
          NextResponse.json(
            { error: pnlOut.error ?? "Could not resolve period or fetch P&L" },
            { status: 500 }
          )
        )
      }
      pnl = pnlOut.data

      bsPositions = bsRes.data
      bsError = bsRes.error
    }

    if (!pnl) {
      return finish(
        NextResponse.json({ error: "Could not resolve period or fetch P&L" }, { status: 500 })
      )
    }

    if (bsError || !bsPositions) {
      return finish(
        NextResponse.json({ error: bsError || "Could not fetch balance sheet" }, { status: 500 })
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
    const cashBalance = extractCash(bsPositions)
    const ar = extractAR(bsPositions)
    const ap = extractAP(bsPositions)

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
      const [pnlPrevRes, bsPrevRes] = await Promise.all([
        getProfitAndLossReport(supabase, {
          businessId,
          period_start: prevStart,
        }),
        getBalanceSheetReport(supabase, {
          businessId,
          period_start: prevStart,
        }),
      ])
      devServiceMetricsLog("previous period reports (P&L + BS parallel)", tPrev)

      const pnlPrev = pnlPrevRes.data
      const bsPrev = bsPrevRes.data
      if (!pnlPrev || !bsPrev) return null

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

      return {
        revenue: revPrev,
        expenses: expPrev,
        netProfit: pnlPrev.totals?.net_profit ?? revPrev - expPrev,
        cashCollected: 0,
        accountsReceivable: explicitPeriod ? null : extractAR(bsPrev),
        accountsPayable: explicitPeriod ? null : extractAP(bsPrev),
        cashBalance: explicitPeriod ? null : extractCash(bsPrev),
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
      positionBalancesAsOfToday: explicitPeriod,
      positionAsOfDate: explicitPeriod ? todayUtc : null,
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
