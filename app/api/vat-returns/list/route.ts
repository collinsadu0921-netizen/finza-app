import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT - Get business from query or use first business
    const { searchParams } = new URL(request.url)
    let businessId = searchParams.get("business_id")

    // If no business_id provided, try to get from user's business
    if (!businessId && user) {
      const business = await getCurrentBusiness(supabase, user.id)
      if (business) {
        businessId = business.id
      }
    }

    // If still no business_id, get first business
    if (!businessId) {
      const { data: firstBusiness } = await supabase
        .from("businesses")
        .select("id")
        .limit(1)
        .single()
      if (firstBusiness) {
        businessId = firstBusiness.id
      }
    }

    let returnsQuery = supabase
      .from("vat_returns")
      .select("*")
      .is("deleted_at", null)
      .order("period_start_date", { ascending: false })

    if (businessId) {
      returnsQuery = returnsQuery.eq("business_id", businessId)
    }

    const { data: returns, error } = await returnsQuery

    if (error) {
      console.error("Error fetching VAT returns:", error)
      // If table doesn't exist, return empty array
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        return NextResponse.json({ returns: [] })
      }
      return NextResponse.json(
        { error: error.message || "Failed to load VAT returns" },
        { status: 500 }
      )
    }

    return NextResponse.json({ returns: returns || [] })
  } catch (error: any) {
    console.error("Error in VAT returns list:", error)
    // Return empty array on error to prevent UI crash
    return NextResponse.json({ returns: [] })
  }
}

