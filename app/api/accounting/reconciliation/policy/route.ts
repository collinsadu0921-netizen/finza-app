/**
 * GET /api/accounting/reconciliation/policy?businessId=...
 * Returns ledger adjustment policy for the business (for UI governance display).
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getLedgerAdjustmentPolicy } from "@/lib/accounting/reconciliation/governance"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { searchParams } = new URL(request.url)
    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
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
        { error: "Missing required query param: businessId" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const tierBlockPol = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      resolvedBusinessId
    )
    if (tierBlockPol) return tierBlockPol

    const policy = await getLedgerAdjustmentPolicy(supabase, resolvedBusinessId)
    return NextResponse.json({ policy })
  } catch (err: unknown) {
    console.error("Reconciliation policy error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load policy" },
      { status: 500 }
    )
  }
}
