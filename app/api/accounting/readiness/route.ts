import { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { ACCOUNTING_NOT_READY } from "@/lib/accounting/reasonCodes"
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
      return respond({ error: "Missing required parameter: business_id" }, 400)
    }
    const resolvedBusinessId = resolved.businessId

    const tAuthority = performance.now()
    const auth = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
    diag.recordTiming("authority", timedStepMs(tAuthority))
    if (!auth.authorized) {
      return respond({ error: ACCOUNTING_NOT_READY, business_id: resolvedBusinessId }, 403)
    }

    const tReady = performance.now()
    const { ready } = await checkAccountingReadiness(supabase, resolvedBusinessId)
    diag.recordTiming("readiness", timedStepMs(tReady))

    const payload: Record<string, unknown> = {
      ready,
      authority_source: auth.authority_source,
      business_id: resolvedBusinessId,
    }

    if (auth.authority_source === "accountant") {
      const tFirm = performance.now()
      const firmAuth = await getAccountingAuthority({
        supabase,
        firmUserId: user.id,
        businessId: resolvedBusinessId,
        requiredLevel: "read",
      })
      diag.recordTiming("engagement", timedStepMs(tFirm))
      payload.access_level = firmAuth.level ?? null
      payload.engagement_status = firmAuth.engagementStatus ?? null
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
