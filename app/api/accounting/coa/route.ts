import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
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
 * GET /api/accounting/coa?business_id=...
 * 
 * Returns read-only Chart of Accounts for accounting mode.
 * Access: Admin or Accountant (read or write) only
 * 
 * Returns:
 * - id
 * - code
 * - name
 * - type (asset/liability/equity/income/expense)
 * - description
 * - is_system
 * 
 * Sorted by code ASC
 */
export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  const diag = createRouteDiag("accounting_coa")
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

    const authResult = await resolveAccountingRequestAuthority({
      supabase,
      userId: user.id,
      businessId,
      requiredLevel: "read",
      authorityContext: "practice-client-books",
    })
    if (authResult.timings) {
      diag.recordTiming("role", authResult.timings.role_ms)
      diag.recordTiming("authority", authResult.timings.authority_ms)
    }
    if (!authResult.ok) {
      return respond(
        { error: authResult.error, reason_code: authResult.reasonCode },
        authResult.status
      )
    }

    const tierBlockCoa = await enforceServiceIndustryBusinessTierForAccountingApi(supabase, user.id, businessId)
    if (tierBlockCoa) return tierBlockCoa

    const dataClient = getAccountingDataClient(authResult, supabase)
    // Get all accounts for business (read-only, no mutations)
    const tDb = performance.now()
    const { data: accounts, error } = await dataClient
      .from("accounts")
      .select("id, code, name, type, description, is_system, sub_type")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .order("code", { ascending: true })

    if (error) {
      console.error("Error fetching Chart of Accounts:", error)
      return NextResponse.json(
        { error: error.message || "Failed to fetch Chart of Accounts" },
        { status: 500 }
      )
    }

    diag.recordTiming("db", timedStepMs(tDb), "accounts")
    return respond({ 
      accounts: accounts || [],
      metadata: {
        total: accounts?.length || 0,
        allowedTypes: ["asset", "liability", "equity"],
        forbiddenTypes: ["income", "expense"],
      }
    }, 200)
  } catch (error: unknown) {
    console.error("Error in COA API:", error)
    return respond(
      { error: error instanceof Error ? error.message : "Internal server error" },
      500
    )
  }
}
