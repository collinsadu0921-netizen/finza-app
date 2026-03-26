import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

/**
 * GET /api/accounting/periods/resolve
 *
 * Read-only period resolver for embedded reports (Option C).
 * Resolves a date range to a single accounting period. No posting, no mutation.
 *
 * Query Parameters:
 * - business_id (required)
 * - from_date (required) - ISO date YYYY-MM-DD; period must contain this date
 * - to_date (optional) - ISO date; if provided, resolver picks a period covering from_date (to_date used for validation only)
 *
 * Returns: { period_id, period_start, period_end }
 * 404: No accounting period covers the selected dates.
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
    const fromDate = searchParams.get("from_date")

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
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    if (!fromDate) {
      return NextResponse.json(
        { error: "Missing required parameter: from_date" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(
      supabase,
      user.id,
      resolvedBusinessId,
      "read"
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. No access to this business." },
        { status: 403 }
      )
    }

    const fromIso = fromDate.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromIso)) {
      return NextResponse.json(
        { error: "from_date must be YYYY-MM-DD" },
        { status: 400 }
      )
    }

    // 1) Find existing period that contains from_date (period_start <= from_date <= period_end)
    const { data: periods, error: findError } = await supabase
      .from("accounting_periods")
      .select("id, period_start, period_end")
      .eq("business_id", resolvedBusinessId)
      .lte("period_start", fromIso)
      .gte("period_end", fromIso)
      .order("period_start", { ascending: false })
      .limit(1)

    if (findError) {
      console.error("period resolve find error:", findError)
      return NextResponse.json(
        { error: "Failed to resolve accounting period" },
        { status: 500 }
      )
    }

    const existing = periods?.[0]
    if (existing) {
      return NextResponse.json({
        period_id: existing.id,
        period_start: existing.period_start,
        period_end: existing.period_end,
      })
    }

    // 2) No period found — try to ensure one exists for this date (read-only from caller's perspective; RPC may create period)
    const { error: ensureError } = await supabase.rpc("ensure_accounting_period", {
      p_business_id: resolvedBusinessId,
      p_date: fromIso,
    })

    if (ensureError) {
      console.error("ensure_accounting_period failed:", ensureError)
      return NextResponse.json(
        { error: "No accounting period covers the selected dates." },
        { status: 404 }
      )
    }

    // 3) Refetch period that contains from_date
    const { data: refetchPeriods, error: refetchError } = await supabase
      .from("accounting_periods")
      .select("id, period_start, period_end")
      .eq("business_id", resolvedBusinessId)
      .lte("period_start", fromIso)
      .gte("period_end", fromIso)
      .order("period_start", { ascending: false })
      .limit(1)

    const resolvedPeriod = refetchPeriods?.[0]
    if (refetchError || !resolvedPeriod) {
      return NextResponse.json(
        { error: "No accounting period covers the selected dates." },
        { status: 404 }
      )
    }

    return NextResponse.json({
      period_id: resolvedPeriod.id,
      period_start: resolvedPeriod.period_start,
      period_end: resolvedPeriod.period_end,
    })
  } catch (error: any) {
    console.error("Error in periods/resolve:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
