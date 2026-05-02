import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

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

    const tierDenied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDenied) return tierDenied

    const { searchParams } = new URL(request.url)
    const category = searchParams.get("category")
    const status = searchParams.get("status")
    const supplier = searchParams.get("supplier")

    let query = supabase
      .from("assets")
      .select("*")
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (category) {
      query = query.eq("category", category)
    }

    if (status) {
      query = query.eq("status", status)
    }

    if (supplier) {
      query = query.ilike("supplier_name", `%${supplier}%`)
    }

    const { data: assets, error } = await query

    if (error) {
      console.error("Error fetching assets:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ assets: assets || [] })
  } catch (error: any) {
    console.error("Error in assets list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


