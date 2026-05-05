import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
    const limitRaw = Number.parseInt(searchParams.get("limit") || "25", 10) || 25
    const limit = Math.min(100, Math.max(1, limitRaw))
    const from = (page - 1) * limit
    const to = from + limit - 1

    const { data, error, count } = await supabase
      .from("service_catalog")
      .select("id, name, default_price, tax_code, is_active", { count: "exact" })
      .eq("business_id", business.id)
      .order("name", { ascending: true })
      .range(from, to)

    if (error) {
      return NextResponse.json({ error: error.message || "Failed to load services" }, { status: 500 })
    }

    const totalCount = count ?? 0
    return NextResponse.json({
      rows: data ?? [],
      pagination: {
        page,
        pageSize: limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
