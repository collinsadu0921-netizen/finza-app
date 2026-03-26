import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { ensureAccountingInitialized, canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

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
    const periodParam = searchParams.get("period") // Format: YYYY-MM

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
        { error: "business_id parameter is required" },
        { status: 400 }
      )
    }
    const resolvedBusinessId = resolved.businessId

    const auth = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "This action isn't available to your role." },
        { status: 403 }
      )
    }

    const canInit = canUserInitializeAccounting(auth.authority_source)
    if (canInit) {
      const bootstrap = await ensureAccountingInitialized(supabase, resolvedBusinessId)
      if (bootstrap.error) {
        const structured = bootstrap.structuredError
        const body = {
          error: "ACCOUNTING_NOT_READY",
          business_id: resolvedBusinessId,
          authority_source: auth.authority_source,
          ...(structured && {
            error_code: structured.error_code,
            message: structured.message,
          }),
        }
        return NextResponse.json(
          body,
          { status: structured?.error_code === "INIT_DENIED" ? 403 : 500 }
        )
      }
    }

    if (!periodParam) {
      return NextResponse.json(
        { error: "Period parameter is required (format: YYYY-MM)" },
        { status: 400 }
      )
    }

    // Parse period (YYYY-MM) to period_start and period_end
    const [year, month] = periodParam.split("-").map(Number)
    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Invalid period format. Use YYYY-MM" },
        { status: 400 }
      )
    }

    const periodStart = new Date(year, month - 1, 1).toISOString().split("T")[0]

    if (canUserInitializeAccounting(auth.authority_source)) {
      await supabase.rpc("create_system_accounts", { p_business_id: resolvedBusinessId })
    }

    const { data: accountingPeriod, error: periodError } = await supabase
      .from("accounting_periods")
      .select("id, status, period_start, period_end")
      .eq("business_id", resolvedBusinessId)
      .eq("period_start", periodStart)
      .maybeSingle()

    if (periodError) {
      console.error("Trial balance period fetch failed:", { businessId: resolvedBusinessId, periodStart, periodError })
      return NextResponse.json(
        {
          error: "Failed to fetch accounting period",
          step: "fetch_period",
          business_id: resolvedBusinessId,
          period_start: periodStart,
          supabase_error: { message: periodError.message, code: periodError.code },
        },
        { status: 500 }
      )
    }

    if (!accountingPeriod) {
      return NextResponse.json(
        { error: "Accounting period not found for period: " + periodParam, business_id: resolvedBusinessId },
        { status: 404 }
      )
    }

    const periodStatus = accountingPeriod.status || "open"
    const isLocked = periodStatus === "locked"
    const periodEnd = accountingPeriod.period_end

    // PHASE 10: Use canonical Trial Balance function (from snapshot)
    const { data: trialBalanceRows, error: rpcError } = await supabase.rpc("get_trial_balance_from_snapshot", {
      p_period_id: accountingPeriod.id,
    })

    if (rpcError) {
      console.error("Error fetching trial balance:", { businessId: resolvedBusinessId, period_id: accountingPeriod.id, rpcError })
      return NextResponse.json(
        {
          error: rpcError.message || "Failed to fetch trial balance",
          step: "get_trial_balance_from_snapshot",
          business_id: resolvedBusinessId,
          period_id: accountingPeriod.id,
          period_start: periodStart,
          period_end: periodEnd,
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
      opening_balance: row.opening_balance || 0,
      period_debit: row.debit_total || 0,
      period_credit: row.credit_total || 0,
      closing_balance: row.closing_balance || 0,
    }))

    // Group by type
    const byType: Record<string, typeof trialBalance> = {
      asset: [],
      liability: [],
      equity: [],
      income: [],
      expense: [],
    }

    trialBalance.forEach((account: any) => {
      byType[account.type].push(account)
    })

    // Calculate totals
    const totalOpeningDebits = trialBalance.reduce((sum: number, acc: any) => {
      if (acc.type === "asset" || acc.type === "expense") {
        return sum + (acc.opening_balance > 0 ? acc.opening_balance : 0)
      }
      return sum
    }, 0)
    const totalOpeningCredits = trialBalance.reduce((sum: number, acc: any) => {
      if (acc.type === "liability" || acc.type === "equity" || acc.type === "income") {
        return sum + (acc.opening_balance > 0 ? acc.opening_balance : 0)
      }
      return sum
    }, 0)
    const totalPeriodDebits = trialBalance.reduce((sum: number, acc: any) => sum + acc.period_debit, 0)
    const totalPeriodCredits = trialBalance.reduce((sum: number, acc: any) => sum + acc.period_credit, 0)
    const totalClosingDebits = trialBalance.reduce((sum: number, acc: any) => {
      if (acc.type === "asset" || acc.type === "expense") {
        return sum + (acc.closing_balance > 0 ? acc.closing_balance : 0)
      }
      return sum
    }, 0)
    const totalClosingCredits = trialBalance.reduce((sum: number, acc: any) => {
      if (acc.type === "liability" || acc.type === "equity" || acc.type === "income") {
        return sum + (acc.closing_balance > 0 ? acc.closing_balance : 0)
      }
      return sum
    }, 0)

    // Check if balanced (opening + period activity should balance)
    const isBalanced = Math.abs(totalPeriodDebits - totalPeriodCredits) < 0.01

    return NextResponse.json({
      period: periodParam,
      period_start: periodStart,
      period_end: periodEnd,
      period_status: periodStatus,
      is_locked: isLocked,
      // PHASE 10: Trial Balance from canonical snapshot
      accounts: trialBalance,
      byType,
      totals: {
        total_opening_debits: Math.round(totalOpeningDebits * 100) / 100,
        total_opening_credits: Math.round(totalOpeningCredits * 100) / 100,
        total_period_debits: Math.round(totalPeriodDebits * 100) / 100,
        total_period_credits: Math.round(totalPeriodCredits * 100) / 100,
        total_closing_debits: Math.round(totalClosingDebits * 100) / 100,
        total_closing_credits: Math.round(totalClosingCredits * 100) / 100,
      },
      isBalanced,
    })
  } catch (error: any) {
    console.error("Error in period trial balance:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


