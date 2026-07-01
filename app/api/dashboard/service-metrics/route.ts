/**
 * GET /api/dashboard/service-metrics?business_id=...
 *
 * Read-only ledger-derived metrics (consolidated RPC + cache).
 */

import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { loadServiceDashboardMetrics } from "@/lib/server/serviceDashboardMetricsLoader"
import { createRouteDiag, isRouteDiagnosticsEnabled, type RouteDiagFields } from "@/lib/server/routeDiagnostics"

function devServiceMetricsLog(label: string, startedAt: number) {
  if (process.env.NODE_ENV === "production" && !isRouteDiagnosticsEnabled()) return
  console.info(`[service-metrics] ${label}: ${(performance.now() - startedAt).toFixed(1)}ms`)
}

export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  let diag = createRouteDiag("dashboard_metrics")
  const finish = (res: NextResponse, businessId?: string | null) => {
    if (businessId && !diag) diag = createRouteDiag("dashboard_metrics", businessId)
    diag?.finish(res.status)
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
      diag.fail(401, "Unauthorized")
      return finish(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) {
      diag.fail(400, "missing business_id")
      return finish(
        NextResponse.json({ error: "Missing required parameter: business_id" }, { status: 400 })
      )
    }

    diag = createRouteDiag("dashboard_metrics", businessId)

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      diag.fail(403, "forbidden")
      return finish(
        NextResponse.json({ error: "You do not have access to this business" }, { status: 403 }),
        businessId
      )
    }
    diag.step("auth", { ms_auth: Math.round((performance.now() - tAuth) * 10) / 10 })

    const payload = await loadServiceDashboardMetrics(
      supabase,
      businessId,
      {
        periodId: searchParams.get("period_id") ?? undefined,
        periodStart: searchParams.get("period_start") ?? undefined,
        previousPeriodStart: searchParams.get("previous_period_start") ?? undefined,
      },
      diag
    )

    return finish(NextResponse.json(payload), businessId)
  } catch (err) {
    const rpcMeta = (err as { rpcMeta?: RouteDiagFields }).rpcMeta
    if (rpcMeta) {
      diag.fail(500, "rpc_error", rpcMeta)
      return finish(
        NextResponse.json({ error: "Could not load dashboard metrics" }, { status: 500 })
      )
    }
    console.error("Dashboard service-metrics error:", err)
    diag.fail(500, err instanceof Error ? err.message : "Server error")
    return finish(
      NextResponse.json(
        { error: err instanceof Error ? err.message : "Server error" },
        { status: 500 }
      )
    )
  }
}
