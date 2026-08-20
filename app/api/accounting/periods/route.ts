import { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
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

    const tCtx = performance.now()
    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    diag.recordTiming("context", timedStepMs(tCtx))
    if ("error" in resolved) {
      return respond({ error: "business_id parameter is required" }, 400)
    }
    const businessId = resolved.businessId

    const tAuthority = performance.now()
    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    diag.recordTiming("authority", timedStepMs(tAuthority))
    if (!auth.authorized) {
      return respond({ error: "Unauthorized. No access to this business." }, 403)
    }

    const tDb = performance.now()
    const { data: periods, error } = await supabase
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
      const { data: users } = await supabase
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
