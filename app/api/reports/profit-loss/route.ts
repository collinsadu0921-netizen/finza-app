import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { ensureAccountingInitialized } from "@/lib/accountingBootstrap"
import { getProfitAndLossReport } from "@/lib/accounting/reports/getProfitAndLossReport"

/**
 * GET /api/reports/profit-loss (legacy)
 *
 * Same canonical P&L as /api/accounting/reports/profit-and-loss.
 * Accountant: business_id required (400 CLIENT_REQUIRED if missing). Owner: fallback to getCurrentBusiness.
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
    const ctx = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      source: "api",
    })
    if ("error" in ctx) {
      return NextResponse.json(
        { error: "Client not selected. Use Control Tower or select a client.", error_code: "CLIENT_REQUIRED" },
        { status: 400 }
      )
    }
    const businessId = ctx.businessId

    const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, businessId)
    if (bootstrapErr) {
      return NextResponse.json({ error: bootstrapErr }, { status: 500 })
    }

    await supabase.rpc("create_system_accounts", { p_business_id: businessId })

    const { data, error } = await getProfitAndLossReport(supabase, {
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
      return NextResponse.json(
        { error: "Could not resolve accounting period." },
        { status: 500 }
      )
    }

    return NextResponse.json(data)
  } catch (err: unknown) {
    console.error("Error in profit & loss:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
