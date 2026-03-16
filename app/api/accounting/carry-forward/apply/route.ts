import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

/**
 * POST /api/accounting/carry-forward/apply
 * 
 * Applies carry-forward from source period to target period
 * Computes ending balances from ledger and creates journal entry
 * 
 * Body:
 * - business_id: UUID
 * - from_period_start: DATE (YYYY-MM-01 format)
 * - to_period_start: DATE (YYYY-MM-01 format)
 * - note: TEXT (optional)
 * 
 * Access: Admin/Owner/Accountant write only (strictest write guard)
 * 
 * Calls the canonical apply_carry_forward RPC function
 * 
 * Note: No equity offset parameter - entry must balance naturally
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
      from_period_start,
      to_period_start,
      note,
    } = body

    // Validate required fields
    if (!business_id || !from_period_start || !to_period_start) {
      return NextResponse.json(
        { error: "Missing required fields: business_id, from_period_start, to_period_start" },
        { status: 400 }
      )
    }

    // Validate from_period_start format (YYYY-MM-01)
    const fromPeriodStartDate = new Date(from_period_start)
    if (isNaN(fromPeriodStartDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid from_period_start format. Must be YYYY-MM-DD" },
        { status: 400 }
      )
    }

    // Verify from_period_start is first day of month
    const expectedFromFirstDay = new Date(
      fromPeriodStartDate.getFullYear(),
      fromPeriodStartDate.getMonth(),
      1
    )
    if (fromPeriodStartDate.getTime() !== expectedFromFirstDay.getTime()) {
      return NextResponse.json(
        { error: "from_period_start must be the first day of the month (YYYY-MM-01)" },
        { status: 400 }
      )
    }

    // Validate to_period_start format (YYYY-MM-01)
    const toPeriodStartDate = new Date(to_period_start)
    if (isNaN(toPeriodStartDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid to_period_start format. Must be YYYY-MM-DD" },
        { status: 400 }
      )
    }

    // Verify to_period_start is first day of month
    const expectedToFirstDay = new Date(
      toPeriodStartDate.getFullYear(),
      toPeriodStartDate.getMonth(),
      1
    )
    if (toPeriodStartDate.getTime() !== expectedToFirstDay.getTime()) {
      return NextResponse.json(
        { error: "to_period_start must be the first day of the month (YYYY-MM-01)" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, business_id, "write")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants with write access can apply carry-forward." },
        { status: 403 }
      )
    }

    // Call the canonical apply_carry_forward RPC function
    const { data: result, error: rpcError } = await supabase.rpc("apply_carry_forward", {
      p_business_id: business_id,
      p_from_period_start: from_period_start,
      p_to_period_start: to_period_start,
      p_created_by: user.id,
      p_note: note || null,
    })

    if (rpcError) {
      console.error("Error applying carry-forward:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to apply carry-forward" },
        { status: 400 } // Usually validation errors, not 500
      )
    }

    if (!result || result.length === 0) {
      return NextResponse.json(
        { error: "Failed to apply carry-forward - no result returned" },
        { status: 500 }
      )
    }

    const { batch_id, journal_entry_id } = result[0]

    return NextResponse.json({
      success: true,
      batch_id,
      journal_entry_id,
      message: "Carry-forward applied successfully",
    })
  } catch (error: any) {
    console.error("Error in carry-forward apply:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
