import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { getBalanceSheetReport } from "@/lib/accounting/reports/getBalanceSheetReport"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import {
  createRouteDiag,
  jsonResponseWithServerTiming,
  timedStepMs,
} from "@/lib/server/routeDiagnostics"

/**
 * GET /api/accounting/reports/balance-sheet
 *
 * Canonical Balance Sheet — ledger-derived from Trial Balance. Period via resolveAccountingPeriodForReport only.
 * Query: business_id (required), period_id | period_start | as_of_date | start_date, end_date (optional).
 *
 * Ready-path does not call create_system_accounts. Readiness overlaps the first report
 * after authority. Production authority remains checkAccountingAuthority.
 */
export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  const diag = createRouteDiag("reports_balance_sheet")
  const respond = <T>(body: T, status: number) =>
    jsonResponseWithServerTiming(body, {
      status,
      serverTiming: diag.serverTimingHeader([{ name: "total", dur: timedStepMs(routeT0) }]),
    })

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    diag.recordTiming("auth", timedStepMs(tAuth), "session")
    if (!user) {
      return respond({ error: "Unauthorized" }, 401)
    }

    const { searchParams } = new URL(request.url)
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
    const businessId = resolved.businessId

    const tAuthz = performance.now()
    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    diag.recordTiming("authority", timedStepMs(tAuthz))
    if (!auth.authorized) {
      return respond(
        { error: "Unauthorized. Only admins, owners, or accountants can view balance sheet." },
        403
      )
    }

    const reportInput = {
      businessId,
      period_id: searchParams.get("period_id") ?? undefined,
      period_start: searchParams.get("period_start") ?? undefined,
      as_of_date: searchParams.get("as_of_date") ?? undefined,
      start_date: searchParams.get("start_date") ?? undefined,
      end_date: searchParams.get("end_date") ?? undefined,
    }

    const canBootstrap = canUserInitializeAccounting(auth.authority_source)

    const tReady = performance.now()
    const [readinessResult, firstReport] = await Promise.all([
      checkAccountingReadiness(supabase, businessId),
      getBalanceSheetReport(supabase, reportInput),
    ])
    diag.recordTiming("ready", timedStepMs(tReady), "parallel")

    let reportResult = firstReport
    if (!readinessResult.ready) {
      if (!canBootstrap) {
        return NextResponse.json(
          {
            error: "ACCOUNTING_NOT_READY",
            business_id: businessId,
            authority_source: auth.authority_source,
          },
          { status: 403 }
        )
      }
      const tBootstrap = performance.now()
      await supabase.rpc("create_system_accounts", { p_business_id: businessId })
      diag.recordTiming("bootstrap", timedStepMs(tBootstrap))
      reportResult = await getBalanceSheetReport(supabase, reportInput)
    }

    const { data, error, timings } = reportResult
    if (timings) {
      diag.recordTiming("period", timings.period_ms)
      diag.recordTiming("bs_rpc", timings.bs_rpc_ms)
      diag.recordTiming("earnings", timings.earnings_rpc_ms)
      diag.recordTiming("biz", timings.business_ms)
      diag.recordTiming("assemble", timings.assemble_ms)
      diag.recordTiming("report", timings.total_ms)
    }

    if (error) {
      return NextResponse.json({ error }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json(
        { error: "Accounting period could not be resolved" },
        { status: 500 }
      )
    }

    return respond(data, 200)
  } catch (err: unknown) {
    console.error("Error in balance sheet:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
