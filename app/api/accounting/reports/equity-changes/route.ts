import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { canUserInitializeAccounting } from "@/lib/accountingBootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { getEquityChangesReport } from "@/lib/accounting/reports/getEquityChangesReport"

/**
 * GET /api/accounting/reports/equity-changes
 *
 * Statement of Changes in Equity — IAS 1.
 * Ledger-derived from get_account_movements(). Period via resolveAccountingPeriodForReport only.
 * Query: business_id (required), period_id | period_start | as_of_date | start_date, end_date (optional).
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
    const businessId = searchParams.get("business_id")
    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can view equity changes statement." },
        { status: 403 }
      )
    }

    if (!canUserInitializeAccounting(auth.authority_source)) {
      const { ready } = await checkAccountingReadiness(supabase, businessId)
      if (!ready) {
        return NextResponse.json(
          { error: "ACCOUNTING_NOT_READY", business_id: businessId, authority_source: auth.authority_source },
          { status: 403 }
        )
      }
    } else {
      await supabase.rpc("create_system_accounts", { p_business_id: businessId })
    }

    const { data, error } = await getEquityChangesReport(supabase, {
      businessId,
      period_id:    searchParams.get("period_id")    ?? undefined,
      period_start: searchParams.get("period_start") ?? undefined,
      as_of_date:   searchParams.get("as_of_date")   ?? undefined,
      start_date:   searchParams.get("start_date")   ?? undefined,
      end_date:     searchParams.get("end_date")     ?? undefined,
    })

    if (error) {
      return NextResponse.json({ error }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json(
        { error: "Accounting period could not be resolved" },
        { status: 500 }
      )
    }

    return NextResponse.json(data)
  } catch (err: unknown) {
    console.error("Error in equity changes statement:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
