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
    let business: { id: string } | null = null
    if (user) {
      business = await getCurrentBusiness(supabase, user.id)
    }
    
    if (!business) {
      const { data: firstBusiness } = await supabase
        .from("businesses")
        .select("id")
        .limit(1)
        .single()
      if (firstBusiness) {
        business = firstBusiness
      }
    }

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Get all asset accounts
    const { data: accounts, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("business_id", business.id)
      .eq("type", "asset")
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
    console.error("Error in reconciliation accounts:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
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
    let business: { id: string } | null = null
    if (user) {
      business = await getCurrentBusiness(supabase, user.id)
    }
    
    if (!business) {
      const { data: firstBusiness } = await supabase
        .from("businesses")
        .select("id")
        .limit(1)
        .single()
      if (firstBusiness) {
        business = firstBusiness
      }
    }

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()
    const { account_id, is_reconcilable } = body

    if (!account_id || typeof is_reconcilable !== "boolean") {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Verify account exists and is an asset
    const { data: account } = await supabase
      .from("accounts")
      .select("id, type")
      .eq("id", account_id)
      .eq("type", "asset")
      .single()

    if (!account) {
      return NextResponse.json(
        { error: "Account not found or not an asset account" },
        { status: 404 }
      )
    }

    const { error: updateError } = await supabase
      .from("accounts")
      .update({ is_reconcilable })
      .eq("id", account_id)

    if (updateError) {
      console.error("Error updating account:", updateError)
      return NextResponse.json(
        { error: updateError.message || "Failed to update account" },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true,
      message: "Account updated successfully" 
    })
  } catch (error: any) {
    console.error("Error updating account:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


