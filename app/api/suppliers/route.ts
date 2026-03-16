import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * POST /api/suppliers
 * Create a new supplier
 */
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
    const { name, phone, email, status } = body

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Supplier name is required" },
        { status: 400 }
      )
    }

    const { data: supplier, error } = await supabase
      .from("suppliers")
      .insert({
        business_id: business.id,
        name: name.trim(),
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        status: status || "active",
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating supplier:", error)
      return NextResponse.json(
        { error: "Failed to create supplier" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      supplier,
    })
  } catch (error: any) {
    console.error("Error in POST /api/suppliers:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/suppliers
 * List suppliers for the business
 */
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
    const search = searchParams.get("search") || ""
    const status = searchParams.get("status")

    let query = supabase
      .from("suppliers")
      .select("*")
      .eq("business_id", business.id)
      .order("name", { ascending: true })

    if (status === "active" || status === "blocked") {
      query = query.eq("status", status)
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`)
    }

    const { data: suppliers, error } = await query

    if (error) {
      console.error("Error loading suppliers:", error)
      return NextResponse.json(
        { error: "Failed to load suppliers" },
        { status: 500 }
      )
    }

    return NextResponse.json({ suppliers: suppliers || [] })
  } catch (error: any) {
    console.error("Error in GET /api/suppliers:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
