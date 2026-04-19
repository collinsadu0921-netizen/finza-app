import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertRetailExpenseAction, gateRetailExpenseBusiness } from "@/lib/retail/expenseAccess"
import { insertExpenseForBusiness } from "@/lib/expenses/insertExpenseForBusiness"

/**
 * GET /api/retail/expenses — list store operating expenses (session business, retail only).
 * Query: category_id, start_date, end_date, limit (default 100, max 200)
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

    const gate = await gateRetailExpenseBusiness(supabase, user.id)
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }

    const perm = await assertRetailExpenseAction(supabase, user.id, gate.businessId, "view")
    if (!perm.ok) {
      return NextResponse.json({ error: perm.error }, { status: perm.status })
    }

    const { searchParams } = new URL(request.url)
    const categoryId = searchParams.get("category_id")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const limitRaw = parseInt(searchParams.get("limit") || "100", 10)
    const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 100))

    let query = supabase
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
      .eq("business_id", gate.businessId)
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .limit(limit)

    if (categoryId) query = query.eq("category_id", categoryId)
    if (startDate) query = query.gte("date", startDate)
    if (endDate) query = query.lte("date", endDate)

    const { data: expenses, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ expenses: expenses || [] })
  } catch (e: unknown) {
    console.error("retail expenses GET:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * POST /api/retail/expenses — record a store operating expense; ledger posting via DB trigger.
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

    const gate = await gateRetailExpenseBusiness(supabase, user.id)
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }

    const perm = await assertRetailExpenseAction(supabase, user.id, gate.businessId, "create")
    if (!perm.ok) {
      return NextResponse.json({ error: perm.error }, { status: perm.status })
    }

    const body = await request.json()
    const {
      supplier,
      category_id,
      amount,
      nhil,
      getfund,
      covid,
      vat,
      total,
      date,
      notes,
      receipt_path,
      currency_code,
      fx_rate,
    } = body

    const result = await insertExpenseForBusiness(supabase, {
      businessId: gate.businessId,
      userId: user.id,
      payload: {
        supplier,
        category_id,
        amount: Number(amount),
        nhil,
        getfund,
        covid,
        vat,
        total: total != null ? Number(total) : Number(amount),
        date,
        notes,
        receipt_path,
        currency_code,
        fx_rate,
      },
      request,
      profileSettingsLabel: "Store profile",
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.code ? { code: result.code } : {}) },
        { status: result.status }
      )
    }

    return NextResponse.json({ success: true, expense: result.expense }, { status: 201 })
  } catch (e: unknown) {
    console.error("retail expenses POST:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
