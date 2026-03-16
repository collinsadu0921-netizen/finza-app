import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

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

    const { data: account, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (error || !account) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ account })
  } catch (error: any) {
    console.error("Error fetching account:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

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

    const body = await request.json()
    const { name, code, type, description } = body

    // Verify account exists and is not system
    const { data: existing } = await supabase
      .from("accounts")
      .select("is_system")
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (!existing) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      )
    }

    if (existing.is_system) {
      return NextResponse.json(
        { error: "Cannot modify system accounts" },
        { status: 400 }
      )
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (name !== undefined) updateData.name = name.trim()
    if (code !== undefined) updateData.code = code.trim()
    if (type !== undefined) {
      if (!["asset", "liability", "equity", "income", "expense"].includes(type)) {
        return NextResponse.json(
          { error: "Invalid account type" },
          { status: 400 }
        )
      }
      updateData.type = type
    }
    if (description !== undefined) updateData.description = description?.trim() || null

    const { data: account, error } = await supabase
      .from("accounts")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (error) {
      console.error("Error updating account:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ account })
  } catch (error: any) {
    console.error("Error updating account:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
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

    // Verify account exists and is not system
    const { data: existing } = await supabase
      .from("accounts")
      .select("is_system")
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (!existing) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      )
    }

    if (existing.is_system) {
      return NextResponse.json(
        { error: "Cannot delete system accounts" },
        { status: 400 }
      )
    }

    // Check if account has journal entries
    const { data: hasEntries } = await supabase
      .from("journal_entry_lines")
      .select("id")
      .eq("account_id", id)
      .limit(1)
      .single()

    if (hasEntries) {
      return NextResponse.json(
        { error: "Cannot delete account with existing transactions" },
        { status: 400 }
      )
    }

    // Soft delete
    const { error } = await supabase
      .from("accounts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)

    if (error) {
      console.error("Error deleting account:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: "Account deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting account:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


