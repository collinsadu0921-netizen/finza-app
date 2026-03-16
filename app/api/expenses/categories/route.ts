import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(request: NextRequest) {
  try {
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

    // Ensure default categories are seeded for this business
    const { error: seedError } = await supabase.rpc("seed_default_expense_categories", {
      business_uuid: business.id,
    })
    
    if (seedError) {
      console.error("Error seeding default categories:", seedError)
      // Continue anyway - don't fail if seeding fails
    }

    const { data: categories, error } = await supabase
      .from("expense_categories")
      .select("*")
      .eq("business_id", business.id)
      .order("is_default", { ascending: false }) // Defaults first
      .order("name", { ascending: true })

    if (error) {
      console.error("Error fetching expense categories:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ categories: categories || [] })
  } catch (error: any) {
    console.error("Error in expense categories:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { business_id, name, description } = body

    if (!business_id || !name) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business || business.id !== business_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const { data: category, error } = await supabase
      .from("expense_categories")
      .insert({
        business_id,
        name,
        description: description || null,
        is_default: false, // Custom categories are never default
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating expense category:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ category }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating expense category:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

