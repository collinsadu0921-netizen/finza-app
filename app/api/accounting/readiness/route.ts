import { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { ACCOUNTING_NOT_READY } from "@/lib/accounting/reasonCodes"
import {
  getAccountingDataClient,
  resolveAccountingRequestAuthority,
} from "@/lib/accounting/resolveAccountingRequestAuthority"
import {
  createRouteDiag,
  jsonResponseWithServerTiming,
  timedStepMs,
} from "@/lib/server/routeDiagnostics"

/**
 * GET /api/accounting/readiness?business_id=...
 *
 * Read-only probe: is accounting initialized for this business?
 * Returns { ready, authority_source } for client readiness guard.
 * Never triggers bootstrap.
 * Authority is resolved once; engagement facts are reused from that result.
 */
export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  const diag = createRouteDiag("accounting_readiness")
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

    const resolvedBusinessId = (
      searchParams.get("business_id") ??
      searchParams.get("businessId") ??
      ""
    ).trim()
    if (!resolvedBusinessId) {
      return respond({ error: "Missing required parameter: business_id" }, 400)
    }

    const auth = await resolveAccountingRequestAuthority({
      supabase,
      userId: user.id,
      businessId: resolvedBusinessId,
      requiredLevel: "read",
      authorityContext: "practice-client-books",
    })
    if (auth.timings) {
      diag.recordTiming("role", auth.timings.role_ms)
      diag.recordTiming("authority", auth.timings.authority_ms)
      diag.recordTiming("membership", auth.timings.membership_ms)
      diag.recordTiming("engagement", auth.timings.engagement_ms)
    }
    if (!auth.ok) {
      return respond({ error: ACCOUNTING_NOT_READY, business_id: resolvedBusinessId }, 403)
    }

    const dataClient = getAccountingDataClient(auth, supabase)
    const tReady = performance.now()
    const { ready } = await checkAccountingReadiness(dataClient, resolvedBusinessId)
    diag.recordTiming("readiness", timedStepMs(tReady))

    const payload: Record<string, unknown> = {
      ready,
      authority_source: auth.isPractice ? "accountant" : auth.authoritySource,
      business_id: resolvedBusinessId,
    }

    if (auth.isPractice) {
      payload.access_level = auth.grantedLevel ?? null
      payload.engagement_status = auth.engagementStatus ?? null
    }

    return respond(payload, 200)
  } catch (error: unknown) {
    console.error("Error in accounting readiness:", error)
    return respond(
      { error: error instanceof Error ? error.message : "Internal server error" },
      500
    )
  }
}
