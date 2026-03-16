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

    // Ensure system accounts exist
    await supabase.rpc("create_system_accounts", { p_business_id: business.id })

    const { data: accounts, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("code", { ascending: true })

    if (error) {
      console.error("Error fetching accounts:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ accounts: accounts || [] })
  } catch (error: any) {
    console.error("Error in accounts list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


