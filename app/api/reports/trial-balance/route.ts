import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { ensureAccountingInitialized } from "@/lib/accountingBootstrap"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"

/**
 * GET /api/reports/trial-balance (legacy)
 * Accountant: business_id required (400 CLIENT_REQUIRED if missing). Owner: fallback to getCurrentBusiness.
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
    const ctx = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      source: "api",
    })
    if ("error" in ctx) {
      return NextResponse.json(
        { error: "Client not selected. Use Control Tower or select a client.", error_code: "CLIENT_REQUIRED" },
        { status: 400 }
      )
    }
    const businessId = ctx.businessId

    const bootstrap = await ensureAccountingInitialized(supabase, businessId)
    if (bootstrap.error) {
      const body = bootstrap.structuredError
        ? {
            error: bootstrap.error,
            error_code: bootstrap.structuredError.error_code,
            message: bootstrap.structuredError.message,
            step: bootstrap.structuredError.step,
            business_id: businessId,
            supabase_error: bootstrap.structuredError.supabase_error,
          }
        : { error: bootstrap.error }
      return NextResponse.json(body, { status: 500 })
    }

    const periodId = searchParams.get("period_id")
    const periodStart = searchParams.get("period_start")
    const asOfDate = searchParams.get("as_of_date")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    await supabase.rpc("create_system_accounts", { p_business_id: businessId })

    const { period: resolvedPeriod, error: resolveError } = await resolveAccountingPeriodForReport(
      supabase,
      { businessId, period_id: periodId, period_start: periodStart, as_of_date: asOfDate, start_date: startDate, end_date: endDate }
    )
    if (resolveError || !resolvedPeriod) {
      console.error("Reports trial balance: period resolve failed", { business_id: businessId, as_of_date: asOfDate, resolveError })
      return NextResponse.json(
        {
          error: resolveError ?? "Could not resolve accounting period.",
          step: "resolveAccountingPeriodForReport",
          business_id: businessId,
          as_of_date: asOfDate ?? null,
          period_id: periodId ?? null,
          period_start: periodStart ?? null,
        },
        { status: 500 }
      )
    }

    const { data: trialBalanceRows, error: rpcError } = await supabase.rpc("get_trial_balance_from_snapshot", {
      p_period_id: resolvedPeriod.period_id,
    })

    if (rpcError) {
      console.error("Reports trial balance: get_trial_balance_from_snapshot failed", {
        business_id: businessId,
        period_id: resolvedPeriod.period_id,
        rpcError,
      })
      return NextResponse.json(
        {
          error: rpcError.message || "Failed to fetch trial balance",
          step: "get_trial_balance_from_snapshot",
          business_id: business.id,
          period_id: resolvedPeriod.period_id,
          period_start: resolvedPeriod.period_start,
          period_end: resolvedPeriod.period_end,
          supabase_error: { message: rpcError.message, code: rpcError.code, details: rpcError.details },
        },
        { status: 500 }
      )
    }

    // Transform canonical Trial Balance to match expected response format
    const trialBalance = (trialBalanceRows || []).map((row: any) => ({
      id: row.account_id,
      name: row.account_name,
      code: row.account_code,
      type: row.account_type,
      debit: row.debit_total || 0,
      credit: row.credit_total || 0,
      balance: row.closing_balance || 0, // Use closing balance as the balance
    }))

    // Group by type
    const byType: Record<string, typeof trialBalance> = {
      asset: [],
      liability: [],
      equity: [],
      income: [],
      expense: [],
    }

    trialBalance.forEach((account) => {
      byType[account.type].push(account)
    })

    // Calculate totals
    const totalDebits = trialBalance.reduce((sum, acc) => sum + acc.debit, 0)
    const totalCredits = trialBalance.reduce((sum, acc) => sum + acc.credit, 0)
    const totalAssets = byType.asset.reduce((sum, acc) => sum + acc.balance, 0)
    const totalLiabilities = byType.liability.reduce((sum, acc) => sum + acc.balance, 0)
    const totalEquity = byType.equity.reduce((sum, acc) => sum + acc.balance, 0)
    const totalIncome = byType.income.reduce((sum, acc) => sum + acc.balance, 0)
    const totalExpenses = byType.expense.reduce((sum, acc) => sum + acc.balance, 0)

    // Calculate net income
    const netIncome = totalIncome - totalExpenses

    return NextResponse.json({
      asOfDate: resolvedPeriod.period_end,
      accounts: trialBalance,
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
      isBalanced: Math.abs(totalDebits - totalCredits) < 0.01,
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


