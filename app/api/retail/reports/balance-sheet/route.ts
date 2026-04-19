import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { getBalanceSheetReport } from "@/lib/accounting/reports/getBalanceSheetReport"
import { gateRetailLedgerReportAccess } from "@/lib/retail/reportAccess"

/**
 * GET /api/retail/reports/balance-sheet
 *
 * Retail workspace entry — same ledger engine as canonical balance sheet, without accounting
 * URL context or workspace headers.
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

    const gate = await gateRetailLedgerReportAccess(supabase, user.id)
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }
    const businessId = gate.businessId

    if (!canUserInitializeAccounting(gate.authoritySource)) {
      const { ready } = await checkAccountingReadiness(supabase, businessId)
      if (!ready) {
        return NextResponse.json(
          {
            error: "RETAIL_BOOKS_NOT_READY",
            message:
              "Your store’s books are not ready yet. Complete setup or record some sales, then try again.",
            business_id: businessId,
            authority_source: gate.authoritySource,
          },
          { status: 403 }
        )
      }
    } else {
      await supabase.rpc("create_system_accounts", { p_business_id: businessId })
    }

    const { searchParams } = new URL(request.url)
    const { data, error } = await getBalanceSheetReport(supabase, {
      businessId,
      period_id: searchParams.get("period_id") ?? undefined,
      period_start: searchParams.get("period_start") ?? undefined,
      as_of_date: searchParams.get("as_of_date") ?? undefined,
      start_date: searchParams.get("start_date") ?? undefined,
      end_date: searchParams.get("end_date") ?? undefined,
    })

    if (error) {
      return NextResponse.json({ error }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: "Report period could not be resolved." }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err: unknown) {
    console.error("Error in retail balance sheet:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
