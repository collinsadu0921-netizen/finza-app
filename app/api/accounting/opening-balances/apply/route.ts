import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

/**
 * POST /api/accounting/opening-balances/apply
 * 
 * Applies opening balances to the ledger as a single balanced journal entry
 * 
 * Body:
 * - business_id: UUID
 * - period_start: DATE (YYYY-MM-01 format)
 * - equity_offset_account_id: UUID
 * - lines: [{ account_id: UUID, amount: NUMERIC }]
 * - note: TEXT (optional)
 * 
 * Access: Admin/Owner/Accountant write only (strictest write guard)
 * 
 * Calls the canonical apply_opening_balances RPC function
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

    const body = await request.json()
    const {
      business_id,
      period_start,
      equity_offset_account_id,
      lines,
      note,
    } = body

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    // Validate required fields
    if (!business_id || !period_start || !equity_offset_account_id || !lines) {
      return NextResponse.json(
        { error: "Missing required fields: business_id, period_start, equity_offset_account_id, lines" },
        { status: 400 }
      )
    }

    // Validate lines array
    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json(
        { error: "lines must be a non-empty array of { account_id, amount }" },
        { status: 400 }
      )
    }

    // Validate each line
    for (const line of lines) {
      if (!line.account_id || typeof line.amount !== "number") {
        return NextResponse.json(
          { error: "Each line must have account_id (UUID) and amount (number)" },
          { status: 400 }
        )
      }
    }

    // Validate period_start format (YYYY-MM-01)
    const periodStartDate = new Date(period_start)
    if (isNaN(periodStartDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid period_start format. Must be YYYY-MM-01" },
        { status: 400 }
      )
    }

    // Verify period_start is first day of month
    const expectedFirstDay = new Date(
      periodStartDate.getFullYear(),
      periodStartDate.getMonth(),
      1
    )
    if (periodStartDate.getTime() !== expectedFirstDay.getTime()) {
      return NextResponse.json(
        { error: "period_start must be the first day of the month (YYYY-MM-01)" },
        { status: 400 }
      )
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams: new URLSearchParams({ business_id: String(business_id) }),
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json(
        { error: "Missing required fields: business_id, period_start, equity_offset_account_id, lines" },
        { status: 400 }
      )
    }
    const resolvedBusinessId = resolved.businessId

    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "write")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants with write access can apply opening balances." },
        { status: 403 }
      )
    }

    // Call the canonical apply_opening_balances RPC function
    const { data: result, error: rpcError } = await supabase.rpc("apply_opening_balances", {
      p_business_id: resolvedBusinessId,
      p_period_start: period_start,
      p_equity_offset_account_id: equity_offset_account_id,
      p_lines: lines.map((line: any) => ({
        account_id: line.account_id,
        amount: line.amount,
      })),
      p_applied_by: user.id,
      p_note: note || null,
    })

    if (rpcError) {
      console.error("Error applying opening balances:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to apply opening balances" },
        { status: 400 } // Usually validation errors, not 500
      )
    }

    if (!result || result.length === 0) {
      return NextResponse.json(
        { error: "Failed to apply opening balances - no result returned" },
        { status: 500 }
      )
    }

    const { batch_id, journal_entry_id } = result[0]

    return NextResponse.json({
      success: true,
      batch_id,
      journal_entry_id,
      message: "Opening balances applied successfully",
    })
  } catch (error: any) {
    console.error("Error in opening balances apply:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
