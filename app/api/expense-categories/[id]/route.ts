import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const resolvedParams = await Promise.resolve(params)
    const categoryId = resolvedParams.id

    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    const body = await request.json()
    const { name, description } = body

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      )
    }

    // Check if category exists and is a default category
    const { data: existingCategory } = await supabase
      .from("expense_categories")
      .select("is_default")
      .eq("id", categoryId)
      .single()

    // Default categories can be renamed, but we keep is_default flag
    const updateData: any = {
      name: name.trim(),
      description: description?.trim() || null,
      updated_at: new Date().toISOString(),
    }
    // Preserve is_default flag if it exists
    if (existingCategory?.is_default !== undefined) {
      updateData.is_default = existingCategory.is_default
    }

    const { data: category, error } = await supabase
      .from("expense_categories")
      .update(updateData)
      .eq("id", categoryId)
      .select()
      .single()

    if (error) {
      console.error("Error updating category:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true,
      category 
    })
  } catch (error: any) {
    console.error("Error in PUT expense category:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
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

    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // Check if category is a default category
    const { data: category } = await supabase
      .from("expense_categories")
      .select("is_default")
      .eq("id", categoryId)
      .single()

    if (category?.is_default) {
      return NextResponse.json(
        { error: "Default categories cannot be deleted" },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from("expense_categories")
      .delete()
      .eq("id", categoryId)

    if (error) {
      console.error("Error deleting category:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error in DELETE expense category:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

