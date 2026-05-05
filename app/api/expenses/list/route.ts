import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"

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
    const search = (searchParams.get("search") || "").trim()
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
    const limitRaw = Number.parseInt(searchParams.get("limit") || "25", 10) || 25
    const limit = Math.min(100, Math.max(1, limitRaw))
    const from = (page - 1) * limit
    const to = from + limit - 1

    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )
    if (!scope.ok) {
      return NextResponse.json(
        { error: scope.error },
        { status: scope.status }
      )
    }
    const businessId = scope.businessId

    let query = supabase
      .from("expenses")
      .select(
        `
        *,
        expense_categories (
          id,
          name
        )
      `,
        { count: "exact" }
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

    if (search) {
      query = query.ilike("supplier", `%${search}%`)
    }
    const { data: expenses, error, count } = await query.range(from, to)

    if (error) {
      console.error("Error fetching expenses:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    const totalCount = count ?? 0
    return NextResponse.json({
      expenses: expenses || [],
      pagination: {
        page,
        pageSize: limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
    })
  } catch (error: any) {
    console.error("Error in expense list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
