import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const typesParam = searchParams.get("types") ?? "asset"
    const types = typesParam.split(",").map(t => t.trim()).filter(Boolean)

    // Get accounts of requested types
    const { data: accounts, error } = await supabase
      .from("accounts")
      .select("id, name, code, type")
      .eq("business_id", business.id)
      .in("type", types)
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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

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


