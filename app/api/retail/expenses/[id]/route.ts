import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertRetailExpenseAction, gateRetailExpenseBusiness } from "@/lib/retail/expenseAccess"

/** GET /api/retail/expenses/[id] — single expense for the current retail store */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: expenseId } = await Promise.resolve(params)
    if (!expenseId) {
      return NextResponse.json({ error: "Expense ID required" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const gate = await gateRetailExpenseBusiness(supabase, user.id)
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }

    const perm = await assertRetailExpenseAction(supabase, user.id, gate.businessId, "view")
    if (!perm.ok) {
      return NextResponse.json({ error: perm.error }, { status: perm.status })
    }

    const { data: expense, error } = await supabase
      .from("expenses")
      .select(
        `
        *,
        expense_categories (
          id,
          name
        )
      `
      )
      .eq("id", expenseId)
      .eq("business_id", gate.businessId)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: "Failed to load expense" }, { status: 500 })
    }
    if (!expense) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 })
    }

    return NextResponse.json({ expense })
  } catch (e: unknown) {
    console.error("retail expenses [id] GET:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
