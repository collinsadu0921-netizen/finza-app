import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { getProfitAndLossReport } from "@/lib/accounting/reports/getProfitAndLossReport"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { createRouteDiag, supabaseErrorDiag, timedStepMs } from "@/lib/server/routeDiagnostics"

/**
 * GET /api/accounting/reports/profit-and-loss
 *
 * Canonical P&L — ledger period movement via getProfitAndLossReport.
 * Query: business_id (required), period_id | period_start | as_of_date | start_date, end_date (optional).
 */
export async function GET(request: NextRequest) {
  let diag = createRouteDiag("reports_pnl")
  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      diag.fail(401, "Unauthorized")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
    diag = createRouteDiag("reports_pnl", businessId)

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      diag.fail(403, "forbidden")
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can view profit & loss." },
        { status: 403 }
      )
    }
    diag.step("auth", { ms_auth: Math.round((performance.now() - tAuth) * 10) / 10 })

    const tReady = performance.now()
    const { ready } = await checkAccountingReadiness(supabase, businessId)
    if (!ready) {
      if (canUserInitializeAccounting(auth.authority_source)) {
        const tBootstrap = performance.now()
        const { error: bootstrapError } = await supabase.rpc("create_system_accounts", {
          p_business_id: businessId,
        })
        diag.step("bootstrap_accounts", {
          ms_bootstrap: timedStepMs(tBootstrap),
          ...(bootstrapError ? supabaseErrorDiag(bootstrapError) : {}),
        })
      } else {
        diag.fail(403, "accounting_not_ready")
        return NextResponse.json(
          { error: "ACCOUNTING_NOT_READY", business_id: businessId, authority_source: auth.authority_source },
          { status: 403 }
        )
      }
    }
    diag.step("readiness", {
      ready,
      ms_readiness: timedStepMs(tReady),
    })

    const tReport = performance.now()
    const { data, error } = await getProfitAndLossReport(supabase, {
      businessId,
      period_id: searchParams.get("period_id") ?? undefined,
      period_start: searchParams.get("period_start") ?? undefined,
      as_of_date: searchParams.get("as_of_date") ?? undefined,
      start_date: searchParams.get("start_date") ?? undefined,
      end_date: searchParams.get("end_date") ?? undefined,
    })

    if (error) {
      diag.fail(500, error, {
        rpc: "get_profit_and_loss_movement",
        ms_report: Math.round((performance.now() - tReport) * 10) / 10,
      })
      return NextResponse.json({ error }, { status: 500 })
    }
    if (!data) {
      diag.fail(500, "period_unresolved")
      return NextResponse.json(
        { error: "Accounting period could not be resolved" },
        { status: 500 }
      )
    }

    diag.step("report", {
      rpc: "get_profit_and_loss_movement",
      ms_report: Math.round((performance.now() - tReport) * 10) / 10,
    })
    diag.finish(200)
    return NextResponse.json(data)
  } catch (err: unknown) {
    console.error("Error in profit & loss:", err)
    diag.fail(500, err instanceof Error ? err.message : "Internal server error")
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
