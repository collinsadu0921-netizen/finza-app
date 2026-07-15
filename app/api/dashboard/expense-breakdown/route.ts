/**
 * GET /api/dashboard/expense-breakdown?business_id=&start_date=&end_date=
 *
 * Read-only ledger expense breakdown for the dashboard info popover.
 * Does not alter dashboard totals — explains finza_dashboard_pnl_totals composition.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { loadDashboardExpenseBreakdown } from "@/lib/server/dashboardExpenseBreakdownLoader"

export const dynamic = "force-dynamic"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

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
    const businessId = searchParams.get("business_id")?.trim() ?? ""
    const startDate = searchParams.get("start_date")?.trim() ?? ""
    const endDate = searchParams.get("end_date")?.trim() ?? ""

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate) || startDate > endDate) {
      return NextResponse.json(
        { error: "Invalid start_date or end_date (expected YYYY-MM-DD)" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "You do not have access to this business" },
        { status: 403 }
      )
    }

    const payload = await loadDashboardExpenseBreakdown(
      supabase,
      businessId,
      startDate,
      endDate
    )

    return NextResponse.json(payload)
  } catch (err) {
    console.error("[expense-breakdown]", err)
    return NextResponse.json({ error: "Failed to load expense breakdown" }, { status: 500 })
  }
}
