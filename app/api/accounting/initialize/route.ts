import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { canUserInitializeAccounting } from "@/lib/accountingBootstrap"
import { ensureAccountingInitialized } from "@/lib/accountingBootstrap"

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

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "write")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "ACCOUNTING_INIT_FORBIDDEN", business_id: businessId },
        { status: 403 }
      )
    }

    if (!canUserInitializeAccounting(auth.authority_source)) {
      return NextResponse.json(
        { error: "ACCOUNTING_INIT_FORBIDDEN", business_id: businessId },
        { status: 403 }
      )
    }

    const bootstrap = await ensureAccountingInitialized(supabase, businessId)
    if (bootstrap.error) {
      return NextResponse.json(
        { error: "ACCOUNTING_INIT_FORBIDDEN", business_id: businessId, message: bootstrap.error },
        { status: 403 }
      )
    }

    await supabase.rpc("create_system_accounts", { p_business_id: businessId })

    return NextResponse.json({ success: true, business_id: businessId })
  } catch (error: any) {
    console.error("Error in accounting initialize:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
