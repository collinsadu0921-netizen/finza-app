import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"

/**
 * GET /api/accounting/periods/has-active-engagement?business_id=
 * Returns whether the business has any active firm engagement (for hybrid period close UI).
 * Requires read accounting authority. RLS on firm_client_engagements applies.
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
    const business_id = searchParams.get("business_id")

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
    const resolvedBusinessId = "error" in resolved ? null : resolved.businessId

    if (!resolvedBusinessId) {
      return NextResponse.json(
        { error: "Missing required query param: business_id" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Accounting access required." },
        { status: 403 }
      )
    }

    const tierBlockHae = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      resolvedBusinessId
    )
    if (tierBlockHae) return tierBlockHae

    const { data, error } = await supabase.rpc("business_has_active_engagement", {
      p_business_id: resolvedBusinessId,
    })

    if (error) {
      console.error("Error checking active engagement:", error)
      return NextResponse.json(
        { error: error.message || "Failed to check engagement" },
        { status: 500 }
      )
    }

    const has_active_engagement = Boolean(data === true || data === "true")
    return NextResponse.json({ has_active_engagement })
  } catch (err: unknown) {
    console.error("Error in has-active-engagement:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
