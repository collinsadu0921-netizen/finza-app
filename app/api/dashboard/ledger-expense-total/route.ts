/**
 * GET /api/dashboard/ledger-expense-total?business_id=...
 *
 * Returns ledger-derived total expenses for the dashboard.
 * Sum of (debit - credit) for accounts where accounts.type = 'expense'.
 * Optional: start_date, end_date (YYYY-MM-DD). Omit for all-time.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

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

    // Ensure user has access to this business (owner or business_users)
    const { data: owner } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .eq("owner_id", user.id)
      .maybeSingle()

    if (owner) {
      // allowed
    } else {
      const { data: bu } = await supabase
        .from("business_users")
        .select("business_id")
        .eq("user_id", user.id)
        .eq("business_id", businessId)
        .maybeSingle()
      if (!bu) {
        return NextResponse.json(
          { error: "You do not have access to this business" },
          { status: 403 }
        )
      }
    }

    const startDate = searchParams.get("start_date") || null
    const endDate = searchParams.get("end_date") || null

    const { data: total, error } = await supabase.rpc("get_ledger_expense_total", {
      p_business_id: businessId,
      p_start_date: startDate,
      p_end_date: endDate,
    })

    if (error) {
      console.error("get_ledger_expense_total RPC error:", error)
      return NextResponse.json(
        { error: "Failed to compute expense total", totalExpenses: 0 },
        { status: 500 }
      )
    }

    const totalExpenses = Number(total ?? 0)
    return NextResponse.json({ totalExpenses })
  } catch (err) {
    console.error("Dashboard ledger-expense-total error:", err)
    return NextResponse.json(
      { error: "Server error", totalExpenses: 0 },
      { status: 500 }
    )
  }
}
