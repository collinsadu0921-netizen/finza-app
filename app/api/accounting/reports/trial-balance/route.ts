import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { ensureAccountingInitialized, canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
import { getTrialBalanceReport } from "@/lib/accounting/reports/getTrialBalanceReport"

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

    const result = await getTrialBalanceReport(supabase, {
      businessId: resolvedBusinessId,
      period_id: periodId,
      period_start: periodStart,
      as_of_date: asOfDate,
      start_date: startDate,
      end_date: endDate,
    })

    if (result.error || !result.data) {
      return NextResponse.json(
        { error: result.error ?? "Failed to fetch trial balance" },
        { status: result.status ?? 500 }
      )
    }

    const { data } = result

    // INVARIANT 3: Fail loudly if unbalanced - never hide ledger errors
    if (!data.isBalanced) {
      return NextResponse.json(
        {
          error: "Trial Balance is unbalanced",
          imbalance: data.imbalance,
          totalDebits: data.totals.totalDebits,
          totalCredits: data.totals.totalCredits,
          message:
            "Ledger integrity error: Debits and credits do not match. This indicates a data corruption issue that must be resolved.",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      period: {
        period_start: data.period.period_start,
        period_end: data.period.period_end,
      },
      accounts: data.accounts,
      byType: data.byType,
      totals: data.totals,
      isBalanced: data.isBalanced,
      // Preserved historical behavior: when balanced, JSON returned 0 here.
      imbalance: 0,
      resolved_period_reason: data.period.resolution_reason,
      resolved_period_start: data.period.period_start,
      resolved_period_end: data.period.period_end,
    })
  } catch (error: any) {
    console.error("Error in trial balance:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
