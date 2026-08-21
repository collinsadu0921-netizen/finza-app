import { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import {
  getAccountingDataClient,
  resolveAccountingRequestAuthority,
} from "@/lib/accounting/resolveAccountingRequestAuthority"
import {
  createRouteDiag,
  jsonResponseWithServerTiming,
  timedStepMs,
} from "@/lib/server/routeDiagnostics"

export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  let diag = createRouteDiag("accounting_periods")
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
      return respond({ error: message }, message === "Unauthorized" ? 401 : 403)
    }

    const businessId = (
      searchParams.get("business_id") ??
      searchParams.get("businessId") ??
      ""
    ).trim()
    if (!businessId) {
      return respond({ error: "business_id parameter is required" }, 400)
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
      return respond({ error: "Unauthorized. No access to this business." }, 403)
    }

    const dataClient = getAccountingDataClient(auth, supabase)

    const tDb = performance.now()
    const { data: periods, error } = await dataClient
      .from("accounting_periods")
      .select("*")
      .eq("business_id", businessId)
      .order("period_start", { ascending: false })

    if (error) {
      console.error("Error fetching accounting periods:", error)
      return respond({ error: error.message }, 500)
    }

    const closedByIds = [
      ...new Set((periods || []).map((p) => p.closed_by).filter((id): id is string => Boolean(id))),
    ]
    const usersById = new Map<string, { id: string; email: string | null; full_name: string | null }>()
    if (closedByIds.length > 0) {
      const { data: users } = await dataClient
        .from("users")
        .select("id, email, full_name")
        .in("id", closedByIds)
      for (const row of users || []) {
        usersById.set(row.id, {
          id: row.id,
          email: row.email ?? null,
          full_name: row.full_name ?? null,
        })
      }
    }

    const periodsWithUsers = (periods || []).map((period) => ({
      ...period,
      closed_by_user: period.closed_by
        ? usersById.get(period.closed_by) ?? {
            id: period.closed_by,
            email: null,
            full_name: null,
          }
        : null,
    }))
    diag.recordTiming("db", timedStepMs(tDb), "periods")

    return respond({ periods: periodsWithUsers }, 200)
  } catch (error: unknown) {
    console.error("Error in accounting periods:", error)
    return respond(
      { error: error instanceof Error ? error.message : "Internal server error" },
      500
    )
  }
}
