import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

// GET /api/customers/{id} - Get customer profile. Retail: sales history. Service: customer only.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    const isRetail = business.industry === "retail"

    // Get customer
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("*")
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (customerError || !customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      )
    }

    if (!isRetail) {
      return NextResponse.json({
        customer,
        industry: business.industry ?? "service",
      })
    }

    // Retail only: sales history (read-only, no totals calculated outside ledger)
    const { data: sales, error: salesError } = await supabase
      .from("sales")
      .select(`
        id,
        amount,
        payment_status,
        payment_method,
        created_at,
        store_id
      `)
      .eq("customer_id", id)
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(100)

    if (salesError) {
      console.error("Error fetching sales:", salesError)
    }

    return NextResponse.json({
      customer,
      sales: sales || [],
      industry: "retail",
    })
  } catch (error: any) {
    console.error("Error in GET /api/customers/[id]:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

// PATCH /api/customers/{id} - Update customer
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    // Verify customer exists and belongs to business
    const { data: existingCustomer, error: checkError } = await supabase
      .from("customers")
      .select("id, status")
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (checkError || !existingCustomer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      )
    }

    const body = await request.json()
    const { name, phone, email, status } = body

    // Build update object
    const updates: Record<string, any> = {}

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return NextResponse.json(
          { error: "Name must be a non-empty string" },
          { status: 400 }
        )
      }
      updates.name = name.trim()
    }

    if (phone !== undefined) {
      if (phone === null || phone === "") {
        updates.phone = null
      } else if (typeof phone !== "string") {
        return NextResponse.json(
          { error: "Phone must be a string" },
          { status: 400 }
        )
      } else {
        updates.phone = phone.trim()
      }
    }

    if (email !== undefined) {
      if (email === null || email === "") {
        updates.email = null
      } else if (typeof email !== "string") {
        return NextResponse.json(
          { error: "Email must be a string" },
          { status: 400 }
        )
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json(
          { error: "Invalid email format" },
          { status: 400 }
        )
      } else {
        updates.email = email.trim()
      }
    }

    if (status !== undefined) {
      if (status !== "active" && status !== "blocked") {
        return NextResponse.json(
          { error: "Status must be 'active' or 'blocked'" },
          { status: 400 }
        )
      }
      updates.status = status
    }

    // If no updates provided
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      )
    }

    // Update customer
    const { data: customer, error: updateError } = await supabase
      .from("customers")
      .update(updates)
      .eq("id", id)
      .eq("business_id", business.id)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating customer:", updateError)
      return NextResponse.json(
        { error: updateError.message || "Failed to update customer" },
        { status: 500 }
      )
    }

    return NextResponse.json({ customer })
  } catch (error: any) {
    console.error("Error in PATCH /api/customers/[id]:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
