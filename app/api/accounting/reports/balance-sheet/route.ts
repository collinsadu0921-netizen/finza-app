import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { getBalanceSheetReport } from "@/lib/accounting/reports/getBalanceSheetReport"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import {
  getAccountingDataClient,
  getAccountingIdentityClient,
  resolveAccountingRequestAuthority,
} from "@/lib/accounting/resolveAccountingRequestAuthority"
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

    const businessId = (
      searchParams.get("business_id") ??
      searchParams.get("businessId") ??
      ""
    ).trim()
    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    const auth = await resolveAccountingRequestAuthority({
      supabase,
      userId: user.id,
      businessId,
      requiredLevel: "read",
      authorityContext: "practice-client-books",
    })
    if (auth.timings) {
      diag.recordTiming("role", auth.timings.role_ms)
      diag.recordTiming("authority", auth.timings.authority_ms)
    }
    if (!auth.ok) {
      return respond(
        { error: auth.error, reason_code: auth.reasonCode },
        auth.status
      )
    }

    const dataClient = getAccountingDataClient(auth, supabase)
    const rpcClient = getAccountingIdentityClient(auth, supabase)
    const reportInput = {
      businessId,
      period_id: searchParams.get("period_id") ?? undefined,
      period_start: searchParams.get("period_start") ?? undefined,
      as_of_date: searchParams.get("as_of_date") ?? undefined,
      start_date: searchParams.get("start_date") ?? undefined,
      end_date: searchParams.get("end_date") ?? undefined,
    }

    const canBootstrap = canUserInitializeAccounting(
      auth.isPractice ? "accountant" : auth.authoritySource
    )

    // After authority: readiness is a cheap existence check and is independent
    // of ledger reads. Do not serialize create_system_accounts on every GET.
    const tReady = performance.now()
    const [readinessResult, firstReport] = await Promise.all([
      checkAccountingReadiness(dataClient, businessId),
      getBalanceSheetReport(dataClient, reportInput, { rpcClient }),
    ])
    diag.recordTiming("ready", timedStepMs(tReady), "parallel")

    let reportResult = firstReport
    if (!readinessResult.ready) {
      if (!canBootstrap) {
        return NextResponse.json(
          {
            error: "ACCOUNTING_NOT_READY",
            business_id: businessId,
            authority_source: auth.authoritySource,
          },
          { status: 403 }
        )
      }
      const tBootstrap = performance.now()
      await supabase.rpc("create_system_accounts", { p_business_id: businessId })
      diag.recordTiming("bootstrap", timedStepMs(tBootstrap))
      reportResult = await getBalanceSheetReport(dataClient, reportInput, { rpcClient })
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
