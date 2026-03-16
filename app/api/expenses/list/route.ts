import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"

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
    const categoryId = searchParams.get("category_id")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const paramBusinessId = searchParams.get("business_id")

    let businessId: string
    if (paramBusinessId) {
      const role = await getUserRole(supabase, user.id, paramBusinessId)
      if (!role) {
        return NextResponse.json(
          { error: "Forbidden: no access to this business" },
          { status: 403 }
        )
      }
      businessId = paramBusinessId
    } else {
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        return NextResponse.json(
          { error: "Business not found" },
          { status: 404 }
        )
      }
      businessId = business.id
    }

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
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    if (categoryId) {
      query = query.eq("category_id", categoryId)
    }

    if (startDate) {
      query = query.gte("date", startDate)
    }

    if (endDate) {
      query = query.lte("date", endDate)
    }

    const { data: expenses, error } = await query

    if (error) {
      console.error("Error fetching expenses:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ expenses: expenses || [] })
  } catch (error: any) {
    console.error("Error in expense list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
