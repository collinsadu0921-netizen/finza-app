import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { ensureAccountingInitialized } from "@/lib/accounting/bootstrap"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

/**
 * POST /api/accounting/initialize
 *
 * Owner/employee only. Initializes accounting for a business (ensure_accounting_initialized + create_system_accounts).
 * Firm users, portal users, and service-only users receive 403 ACCOUNTING_INIT_FORBIDDEN.
 */
export async function POST(request: NextRequest) {
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

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
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

    const auth = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "write")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "ACCOUNTING_INIT_FORBIDDEN", business_id: resolvedBusinessId },
        { status: 403 }
      )
    }

    if (!canUserInitializeAccounting(auth.authority_source)) {
      return NextResponse.json(
        { error: "ACCOUNTING_INIT_FORBIDDEN", business_id: resolvedBusinessId },
        { status: 403 }
      )
    }

    const bootstrap = await ensureAccountingInitialized(supabase, resolvedBusinessId)
    if (bootstrap.error) {
      return NextResponse.json(
        { error: "ACCOUNTING_INIT_FORBIDDEN", business_id: resolvedBusinessId, message: bootstrap.error },
        { status: 403 }
      )
    }

    await supabase.rpc("create_system_accounts", { p_business_id: resolvedBusinessId })

    return NextResponse.json({ success: true, business_id: resolvedBusinessId })
  } catch (error: any) {
    console.error("Error in accounting initialize:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
