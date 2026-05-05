import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"

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

    const body = await request.json()
    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      typeof body.business_id === "string" ? body.business_id : null
    )
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const business = { id: scope.businessId }
    const { name, phone, email, address, tin, whatsapp_phone } = body

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

    if (address !== undefined && address !== null && typeof address !== "string") {
      return NextResponse.json({ error: "Address must be a string" }, { status: 400 })
    }
    if (tin !== undefined && tin !== null && typeof tin !== "string") {
      return NextResponse.json({ error: "TIN must be a string" }, { status: 400 })
    }
    if (whatsapp_phone !== undefined && whatsapp_phone !== null && typeof whatsapp_phone !== "string") {
      return NextResponse.json({ error: "WhatsApp number must be a string" }, { status: 400 })
    }

    const addressVal =
      address === undefined || address === null ? null : address.trim() || null
    const tinVal = tin === undefined || tin === null ? null : tin.trim() || null
    const whatsappVal =
      whatsapp_phone === undefined || whatsapp_phone === null
        ? null
        : whatsapp_phone.trim() || null

    // Create customer
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .insert({
        business_id: business.id,
        name: name.trim(),
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        address: addressVal,
        tin: tinVal,
        whatsapp_phone: whatsappVal,
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

    const { searchParams } = new URL(request.url)
    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const business = { id: scope.businessId }
    const search = searchParams.get("search") || ""
    const status = searchParams.get("status") // Don't default - only filter if explicitly requested
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10) || 25))
    const offset =
      parseInt(searchParams.get("offset") || "", 10) >= 0
        ? parseInt(searchParams.get("offset") || "0", 10)
        : (page - 1) * limit

    // Build query - select all fields (status may not exist if migration hasn't run)
    let query = supabase
      .from("customers")
      .select("*", { count: "exact" })
      .eq("business_id", business.id)
      .order("name", { ascending: true })

    // Filter by status only if explicitly requested (and migration has run)
    // If status column doesn't exist, this will fail gracefully with a clear error
    if (status === "active" || status === "blocked") {
      query = query.eq("status", status)
    }

    // Search by name, phone, email, address, or TIN
    if (search.trim().length > 0) {
      const searchTerm = `%${search.trim()}%`
      query = query.or(
        `name.ilike.${searchTerm},phone.ilike.${searchTerm},email.ilike.${searchTerm},address.ilike.${searchTerm},tin.ilike.${searchTerm}`
      )
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: customers, error: customersError, count } = await query

    if (customersError) {
      console.error("Error fetching customers:", customersError)
      return NextResponse.json(
        { error: customersError.message || "Failed to fetch customers" },
        { status: 500 }
      )
    }

    const totalCount = count ?? 0
    return NextResponse.json({
      customers: customers || [],
      pagination: {
        page,
        pageSize: limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
    })
  } catch (error: any) {
    console.error("Error in GET /api/customers:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
