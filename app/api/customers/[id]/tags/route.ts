import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function PUT(
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

    // Verify customer belongs to business
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      )
    }

    const body = await request.json()
    const { tags } = body

    if (!Array.isArray(tags)) {
      return NextResponse.json(
        { error: "Tags must be an array" },
        { status: 400 }
      )
    }

    // Update tags
    const { data: updatedCustomer, error } = await supabase
      .from("customers")
      .update({ tags: tags.filter((t: string) => t && t.trim()) })
      .eq("id", id)
      .eq("business_id", business.id)
      .select()
      .single()

    if (error) {
      console.error("Error updating tags:", error)
      return NextResponse.json(
        { error: "Failed to update tags" },
        { status: 500 }
      )
    }

    return NextResponse.json({ customer: updatedCustomer })
  } catch (error: any) {
    console.error("Error updating customer tags:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
