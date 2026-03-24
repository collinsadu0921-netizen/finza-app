import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const resolvedParams = await Promise.resolve(params)
    const categoryId = resolvedParams.id

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business.id, minTier: "starter",
    })
    if (denied) return denied

    const body = await request.json()
    const { name, description } = body

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }

    // Fetch category — scoped to the authenticated business for ownership verification
    const { data: existingCategory } = await supabase
      .from("expense_categories")
      .select("is_default")
      .eq("id", categoryId)
      .eq("business_id", business.id)
      .single()

    if (!existingCategory) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }

    const { data: category, error } = await supabase
      .from("expense_categories")
      .update({
        name:        name.trim(),
        description: description?.trim() || null,
        is_default:  existingCategory.is_default,
        updated_at:  new Date().toISOString(),
      })
      .eq("id", categoryId)
      .eq("business_id", business.id)
      .select()
      .single()

    if (error) {
      console.error("Error updating category:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, category })
  } catch (error: any) {
    console.error("Error in PUT expense category:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const resolvedParams = await Promise.resolve(params)
    const categoryId = resolvedParams.id

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business.id, minTier: "starter",
    })
    if (denied) return denied

    // Fetch category scoped to the authenticated business
    const { data: category } = await supabase
      .from("expense_categories")
      .select("is_default")
      .eq("id", categoryId)
      .eq("business_id", business.id)
      .single()

    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }

    if (category.is_default) {
      return NextResponse.json({ error: "Default categories cannot be deleted" }, { status: 400 })
    }

    const { error } = await supabase
      .from("expense_categories")
      .delete()
      .eq("id", categoryId)
      .eq("business_id", business.id)

    if (error) {
      console.error("Error deleting category:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error in DELETE expense category:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
