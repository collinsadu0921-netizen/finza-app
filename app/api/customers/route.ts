import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

// POST /api/customers - Create customer
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
    const { name, phone, email } = body

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      )
    }

    // Validate phone format if provided
    if (phone && typeof phone !== "string") {
      return NextResponse.json(
        { error: "Phone must be a string" },
        { status: 400 }
      )
    }

    // Validate email format if provided
    if (email && typeof email !== "string") {
      return NextResponse.json(
        { error: "Email must be a string" },
        { status: 400 }
      )
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      )
    }

    // Create customer
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .insert({
        business_id: business.id,
        name: name.trim(),
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        status: "active",
      })
      .select()
      .single()

    if (customerError) {
      console.error("Error creating customer:", customerError)
      return NextResponse.json(
        { error: customerError.message || "Failed to create customer" },
        { status: 500 }
      )
    }

    return NextResponse.json({ customer }, { status: 201 })
  } catch (error: any) {
    console.error("Error in POST /api/customers:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

// GET /api/customers - List customers with search
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
    const status = searchParams.get("status") // Don't default - only filter if explicitly requested
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")

    // Build query - select all fields (status may not exist if migration hasn't run)
    let query = supabase
      .from("customers")
      .select("*")
      .eq("business_id", business.id)
      .order("name", { ascending: true })

    // Filter by status only if explicitly requested (and migration has run)
    // If status column doesn't exist, this will fail gracefully with a clear error
    if (status === "active" || status === "blocked") {
      query = query.eq("status", status)
    }

    // Search by name, phone, or email
    if (search.trim().length > 0) {
      const searchTerm = `%${search.trim()}%`
      query = query.or(
        `name.ilike.${searchTerm},phone.ilike.${searchTerm},email.ilike.${searchTerm}`
      )
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: customers, error: customersError } = await query

    if (customersError) {
      console.error("Error fetching customers:", customersError)
      return NextResponse.json(
        { error: customersError.message || "Failed to fetch customers" },
        { status: 500 }
      )
    }

    return NextResponse.json({ customers: customers || [] })
  } catch (error: any) {
    console.error("Error in GET /api/customers:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
