import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const { name, code, type, description } = body

    if (!name || !code || !type) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Validate type
    if (!["asset", "liability", "equity", "income", "expense"].includes(type)) {
      return NextResponse.json(
        { error: "Invalid account type" },
        { status: 400 }
      )
    }

    // Check if code already exists
    const { data: existing } = await supabase
      .from("accounts")
      .select("id")
      .eq("business_id", business.id)
      .eq("code", code)
      .is("deleted_at", null)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: "Account code already exists" },
        { status: 400 }
      )
    }

    const { data: account, error } = await supabase
      .from("accounts")
      .insert({
        business_id: business.id,
        name: name.trim(),
        code: code.trim(),
        type,
        description: description?.trim() || null,
        is_system: false,
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating account:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ account }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating account:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


