import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * GET /api/suppliers/[id]
 * Get supplier details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: supplierId } = await params
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

    // supplierId already extracted from params above

    const { data: supplier, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("id", supplierId)
      .eq("business_id", business.id)
      .single()

    if (error || !supplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ supplier })
  } catch (error: any) {
    console.error("Error in GET /api/suppliers/[id]:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/suppliers/[id]
 * Update supplier details
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: supplierId } = await params
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

    // Validate supplier exists
    const { data: existingSupplier, error: fetchError } = await supabase
      .from("suppliers")
      .select("*")
      .eq("id", supplierId)
      .eq("business_id", business.id)
      .single()

    if (fetchError || !existingSupplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      )
    }

    // Build update object
    const updates: any = {}
    if (name !== undefined) {
      if (!name || !name.trim()) {
        return NextResponse.json(
          { error: "Supplier name cannot be empty" },
          { status: 400 }
        )
      }
      updates.name = name.trim()
    }
    if (phone !== undefined) {
      updates.phone = phone?.trim() || null
    }
    if (email !== undefined) {
      updates.email = email?.trim() || null
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

    const { data: updatedSupplier, error: updateError } = await supabase
      .from("suppliers")
      .update(updates)
      .eq("id", supplierId)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating supplier:", updateError)
      return NextResponse.json(
        { error: "Failed to update supplier" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      supplier: updatedSupplier,
    })
  } catch (error: any) {
    console.error("Error in PATCH /api/suppliers/[id]:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
