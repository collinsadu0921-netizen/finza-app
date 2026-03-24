import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"

/**
 * Update a user's store assignment
 * PUT /api/users/[id]/store
 * Body: { store_id: string | null }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const userId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser()

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, currentUser.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Check permissions: Only owner/admin can assign stores
    if (currentUser) {
      const role = await getUserRole(supabase, currentUser.id, business.id)
      if (role !== "owner" && role !== "admin") {
        return NextResponse.json(
          { error: "Only owners and admins can assign stores to users" },
          { status: 403 }
        )
      }
    }

    const body = await request.json()
    const { store_id } = body

    // Validate store_id if provided
    if (store_id !== null && store_id !== undefined) {
      const { data: store, error: storeError } = await supabase
        .from("stores")
        .select("id, business_id")
        .eq("id", store_id)
        .single()

      if (storeError || !store) {
        return NextResponse.json(
          { error: "Store not found" },
          { status: 404 }
        )
      }

      // Ensure store belongs to the same business
      if (store.business_id !== business.id) {
        return NextResponse.json(
          { error: "Store does not belong to this business" },
          { status: 403 }
        )
      }
    }

    // Update user's store_id
    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update({ store_id: store_id || null })
      .eq("id", userId)
      .select("id, email, full_name, store_id")
      .single()

    if (updateError) {
      console.error("Error updating user store:", updateError)
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      user: updatedUser,
      message: store_id 
        ? "Store assigned successfully" 
        : "Store assignment removed successfully"
    })
  } catch (error: any) {
    console.error("Error updating user store:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}




