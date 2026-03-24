import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const business_id = searchParams.get("business_id")

    if (!business_id) {
      return NextResponse.json({ error: "business_id is required" }, { status: 400 })
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business_id, minTier: "starter",
    })
    if (denied) return denied

    // Ensure default categories are seeded for this business
    const { error: seedError } = await supabase.rpc("seed_default_expense_categories", {
      business_uuid: business_id,
    })
    if (seedError) {
      console.error("Error seeding default categories:", seedError)
      // Non-fatal — continue even if seeding fails
    }

    const { data: categories, error } = await supabase
      .from("expense_categories")
      .select("*")
      .eq("business_id", business_id)
      .order("is_default", { ascending: false })
      .order("name",       { ascending: true  })

    if (error) {
      console.error("Error fetching categories:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ categories: categories || [] })
  } catch (error: any) {
    console.error("Error in GET expense categories:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { business_id, name, description } = body

    if (!business_id || !name) {
      return NextResponse.json({ error: "business_id and name are required" }, { status: 400 })
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business_id, minTier: "starter",
    })
    if (denied) return denied

    const { data: category, error } = await supabase
      .from("expense_categories")
      .insert({
        business_id,
        name: name.trim(),
        description: description?.trim() || null,
        is_default: false,
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating category:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, category }, { status: 201 })
  } catch (error: any) {
    console.error("Error in POST expense category:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
