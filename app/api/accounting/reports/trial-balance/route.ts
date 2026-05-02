import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { ensureAccountingInitialized, canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"

/**
 * GET /api/accounting/reports/trial-balance
 *
 * Returns trial balance from canonical Trial Balance snapshot.
 * Canonical source: trial_balance_snapshots (generated from period_opening_balances + journal_entry_lines).
 * Period: resolved server-side via universal resolver (period_id | period_start | as_of_date | start_date/end_date | latest_activity | fallback).
 *
 * Query Parameters:
 * - business_id (required)
 * - period_id (optional)
 * - period_start (optional)
 * - as_of_date (optional)
 * - start_date, end_date (optional) — mapped to accounting period
 *
 * Access: Admin/Owner/Accountant (read or write)
 */
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
    const periodId = searchParams.get("period_id")
    const periodStart = searchParams.get("period_start")
    const asOfDate = searchParams.get("as_of_date")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }
    const resolvedBusinessId = resolved.businessId

    const auth = await checkAccountingAuthority(
      supabase,
      user.id,
      resolvedBusinessId,
      "read"
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "This action isn't available to your role." },
        { status: 403 }
      )
    }

    const tierBlockTb = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      resolvedBusinessId
    )
    if (tierBlockTb) return tierBlockTb

    if (!canUserInitializeAccounting(auth.authority_source)) {
      const { ready } = await checkAccountingReadiness(supabase, resolvedBusinessId)
      if (!ready) {
        return NextResponse.json(
          { error: "ACCOUNTING_NOT_READY", business_id: resolvedBusinessId, authority_source: auth.authority_source },
          { status: 403 }
        )
      }
    } else {
      const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, resolvedBusinessId)
      if (bootstrapErr) {
        return NextResponse.json(
          { error: "ACCOUNTING_NOT_READY", business_id: resolvedBusinessId, authority_source: auth.authority_source },
          { status: 500 }
        )
      }
      await supabase.rpc("create_system_accounts", { p_business_id: resolvedBusinessId })
    }

    const { period: resolvedPeriod, error: resolveError } = await resolveAccountingPeriodForReport(
      supabase,
      { businessId: resolvedBusinessId, period_id: periodId, period_start: periodStart, as_of_date: asOfDate, start_date: startDate, end_date: endDate }
    )
    if (resolveError || !resolvedPeriod) {
      return NextResponse.json(
        { error: resolveError ?? "Accounting period could not be resolved" },
        { status: 500 }
      )
    }

    const { data: trialBalance, error: rpcError } = await supabase.rpc("get_trial_balance_from_snapshot", {
      p_period_id: resolvedPeriod.period_id,
    })

    if (rpcError) {
      console.error("Error fetching trial balance:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to fetch trial balance" },
        { status: 500 }
      )
    }

    const normalizeNumber = (v: unknown): number =>
      typeof v === "number" && !Number.isNaN(v) ? v : 0

    const accountsNormalized = (trialBalance || []).map((acc: Record<string, unknown>) => ({
      ...acc,
      opening_balance: normalizeNumber(acc.opening_balance),
      debit_total: normalizeNumber(acc.debit_total),
      credit_total: normalizeNumber(acc.credit_total),
      closing_balance: normalizeNumber(acc.closing_balance),
      ending_balance: normalizeNumber(acc.closing_balance ?? acc.ending_balance),
    }))

    const byType: Record<string, typeof accountsNormalized> = {
      asset: [],
      liability: [],
      equity: [],
      income: [],
      expense: [],
    }

    accountsNormalized.forEach((account: Record<string, unknown>) => {
      const t = (account.account_type as string) || "expense"
      if (byType[t]) byType[t].push(account)
    })

    // Calculate totals from normalized accounts (unchanged logic)
    const totalDebits = accountsNormalized.reduce((sum: number, acc: Record<string, unknown>) => sum + (acc.debit_total as number), 0)
    const totalCredits = accountsNormalized.reduce((sum: number, acc: Record<string, unknown>) => sum + (acc.credit_total as number), 0)
    const totalAssets = byType.asset.reduce((sum: number, acc: Record<string, unknown>) => sum + (acc.closing_balance as number), 0)
    const totalLiabilities = byType.liability.reduce((sum: number, acc: Record<string, unknown>) => sum + (acc.closing_balance as number), 0)
    const totalEquity = byType.equity.reduce((sum: number, acc: Record<string, unknown>) => sum + (acc.closing_balance as number), 0)
    const totalIncome = byType.income.reduce((sum: number, acc: Record<string, unknown>) => sum + (acc.closing_balance as number), 0)
    const totalExpenses = byType.expense.reduce((sum: number, acc: Record<string, unknown>) => sum + (acc.closing_balance as number), 0)
    const netIncome = totalIncome - totalExpenses

    // INVARIANT 3: Fail loudly if unbalanced - never hide ledger errors
    const imbalance = totalDebits - totalCredits
    const isBalanced = Math.abs(imbalance) < 0.01

    if (!isBalanced) {
      return NextResponse.json(
        {
          error: "Trial Balance is unbalanced",
          imbalance: Math.round(imbalance * 100) / 100,
          totalDebits: Math.round(totalDebits * 100) / 100,
          totalCredits: Math.round(totalCredits * 100) / 100,
          message: "Ledger integrity error: Debits and credits do not match. This indicates a data corruption issue that must be resolved.",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      period: {
        period_start: resolvedPeriod.period_start,
        period_end: resolvedPeriod.period_end,
      },
      accounts: accountsNormalized,
      byType,
      totals: {
        totalDebits: Math.round(totalDebits * 100) / 100,
        totalCredits: Math.round(totalCredits * 100) / 100,
        totalAssets: Math.round(totalAssets * 100) / 100,
        totalLiabilities: Math.round(totalLiabilities * 100) / 100,
        totalEquity: Math.round(totalEquity * 100) / 100,
        totalIncome: Math.round(totalIncome * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        netIncome: Math.round(netIncome * 100) / 100,
      },
      isBalanced,
      imbalance: 0,
      resolved_period_reason: resolvedPeriod.resolution_reason,
      resolved_period_start: resolvedPeriod.period_start,
      resolved_period_end: resolvedPeriod.period_end,
    })
  } catch (error: any) {
    console.error("Error in trial balance:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
