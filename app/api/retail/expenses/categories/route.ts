import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertRetailExpenseAction, gateRetailExpenseBusiness } from "@/lib/retail/expenseAccess"

/** GET — list expense categories for the session retail business (seeds defaults). */
export async function GET() {
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

    const { error: seedError } = await supabase.rpc("seed_default_expense_categories", {
      business_uuid: gate.businessId,
    })
    if (seedError) {
      console.error("seed_default_expense_categories:", seedError)
    }

    const { data: categories, error } = await supabase
      .from("expense_categories")
      .select("*")
      .eq("business_id", gate.businessId)
      .order("is_default", { ascending: false })
      .order("name", { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ categories: categories || [] })
  } catch (e: unknown) {
    console.error("retail expense categories GET:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}

/** POST — create a custom category (requires expenses.create). */
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
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const description = typeof body.description === "string" ? body.description.trim() : ""
    if (!name) {
      return NextResponse.json({ error: "Category name is required" }, { status: 400 })
    }

    const { data: category, error } = await supabase
      .from("expense_categories")
      .insert({
        business_id: gate.businessId,
        name,
        description: description || null,
        is_default: false,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ category }, { status: 201 })
  } catch (e: unknown) {
    console.error("retail expense categories POST:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
