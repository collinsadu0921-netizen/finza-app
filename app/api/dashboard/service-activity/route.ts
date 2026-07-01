/**
 * GET /api/dashboard/service-activity?business_id=...&limit=10
 *
 * Activity feed with journal RPC + 30s payload cache.
 */

import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { loadOrComputeDashboardActivityCache } from "@/lib/server/dashboardClusterCache"
import {
  loadServiceDashboardActivityFeed,
  MAX_ACTIVITY_LIMIT,
} from "@/lib/server/serviceDashboardActivityLoader"
import { createRouteDiag, isRouteDiagnosticsEnabled } from "@/lib/server/routeDiagnostics"

function devServiceActivityLog(label: string, startedAt: number) {
  if (process.env.NODE_ENV === "production" && !isRouteDiagnosticsEnabled()) return
  console.info(`[service-activity] ${label}: ${(performance.now() - startedAt).toFixed(1)}ms`)
}

export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  let diag = createRouteDiag("dashboard_activity")
  const finish = (res: NextResponse) => {
    diag.finish(res.status)
    devServiceActivityLog("total route", routeT0)
    return res
  }

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return finish(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) {
      return finish(NextResponse.json({ error: "Missing business_id" }, { status: 400 }))
    }

    diag = createRouteDiag("dashboard_activity", businessId)

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      diag.fail(403, "forbidden")
      return finish(NextResponse.json({ error: "Forbidden" }, { status: 403 }))
    }
    diag.step("auth", { ms_auth: Math.round((performance.now() - tAuth) * 10) / 10 })

    const limit = Math.min(
      MAX_ACTIVITY_LIMIT,
      Math.max(1, parseInt(searchParams.get("limit") ?? "10", 10) || 10)
    )
    const cacheKey = `activity|${businessId}|${limit}`

    try {
      const { value, source, cache_enabled } = await loadOrComputeDashboardActivityCache(
        cacheKey,
        () => loadServiceDashboardActivityFeed(supabase, businessId, limit, diag)
      )
      diag.step("cache", { source, cache_enabled, ttl_sec: 30 })
      return finish(NextResponse.json(value))
    } catch (journalErr) {
      const message =
        journalErr && typeof journalErr === "object" && "message" in journalErr
          ? String((journalErr as { message: string }).message)
          : "Journal activity unavailable"
      return finish(NextResponse.json({ error: message }, { status: 500 }))
    }
  } catch (err) {
    console.error("service-activity error:", err)
    diag.fail(500, err instanceof Error ? err.message : "Server error")
    return finish(NextResponse.json({ error: "Server error" }, { status: 500 }))
  }
}
