import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { ACCOUNTING_NOT_READY } from "@/lib/accounting/reasonCodes"

/**
 * GET /api/accounting/readiness?business_id=...
 *
 * Read-only probe: is accounting initialized for this business?
 * Returns { ready, authority_source } for client readiness guard.
 * Never triggers bootstrap.
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
    const businessId = searchParams.get("business_id")?.trim()

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

    const auth = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: ACCOUNTING_NOT_READY, business_id: resolvedBusinessId },
        { status: 403 }
      )
    }

    const { ready } = await checkAccountingReadiness(supabase, resolvedBusinessId)

    const payload: Record<string, unknown> = {
      ready,
      authority_source: auth.authority_source,
      business_id: resolvedBusinessId,
    }

    if (auth.authority_source === "accountant") {
      const firmAuth = await getAccountingAuthority({
        supabase,
        firmUserId: user.id,
        businessId: resolvedBusinessId,
        requiredLevel: "read",
      })
      payload.access_level = firmAuth.level ?? null
      payload.engagement_status = firmAuth.engagementStatus ?? null
    }

    return NextResponse.json(payload)
  } catch (error: any) {
    console.error("Error in accounting readiness:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
