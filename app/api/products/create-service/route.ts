import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

const SERVICE_CREATION_BOUNDARY_VIOLATION = "SERVICE_CREATION_BOUNDARY_VIOLATION"

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

    const body = await request.json().catch(() => ({}))
    const {
      create_as,
      name,
      unit_price,
      tax_applicable = true,
      category_id = null,
      description = null,
    } = body as {
      create_as?: string
      name?: string
      unit_price?: number
      tax_applicable?: boolean
      category_id?: string | null
      description?: string | null
    }

    // Creation boundary guard: intent MUST be explicit service
    if (create_as !== "service") {
      return NextResponse.json(
        {
          error: SERVICE_CREATION_BOUNDARY_VIOLATION,
          message:
            "Create Service must write to products_services only. Missing or invalid create_as.",
        },
        { status: 422 }
      )
    }

    const trimmedName = typeof name === "string" ? name.trim() : ""
    if (!trimmedName) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      )
    }

    const price = typeof unit_price === "number" ? unit_price : parseFloat(String(unit_price ?? ""))
    if (Number.isNaN(price) || price < 0) {
      return NextResponse.json(
        { error: "unit_price must be a non-negative number" },
        { status: 400 }
      )
    }

    // Ensure we never write to products or products_stock (defensive; this handler only writes to products_services)
    const targetTable = "products_services"
    if (targetTable !== "products_services") {
      return NextResponse.json(
        {
          error: SERVICE_CREATION_BOUNDARY_VIOLATION,
          message: "Create Service must write to products_services only. Writing to products is not allowed.",
        },
        { status: 422 }
      )
    }

    if (business.industry !== "service") {
      return NextResponse.json(
        { error: "This endpoint is only for service businesses" },
        { status: 400 }
      )
    }

    const { data: row, error: insertError } = await supabase
      .from("products_services")
      .insert({
        business_id: business.id,
        name: trimmedName,
        unit_price: price,
        type: "service",
        tax_applicable: Boolean(tax_applicable),
        category_id: category_id || null,
        description: description != null ? String(description).trim() || null : null,
      })
      .select("id, business_id, name, unit_price, type, tax_applicable, category_id, description, created_at")
      .single()

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 400 }
      )
    }

    return NextResponse.json(row, { status: 201 })
  } catch (err: unknown) {
    console.error("create-service error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
