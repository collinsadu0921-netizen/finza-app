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

    // Get notes
    const { data: notes, error } = await supabase
      .from("customer_notes")
      .select("id, note, created_at, created_by")
      .eq("customer_id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching notes:", error)
      return NextResponse.json(
        { error: "Failed to fetch notes" },
        { status: 500 }
      )
    }

    return NextResponse.json({ notes: notes || [] })
  } catch (error: any) {
    console.error("Error loading customer notes:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(
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
    const { note } = body

    if (!note || !note.trim()) {
      return NextResponse.json(
        { error: "Note is required" },
        { status: 400 }
      )
    }

    // Create note
    const { data: newNote, error } = await supabase
      .from("customer_notes")
      .insert({
        business_id: business.id,
        customer_id: id,
        note: note.trim(),
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating note:", error)
      return NextResponse.json(
        { error: "Failed to create note" },
        { status: 500 }
      )
    }

    return NextResponse.json({ note: newNote })
  } catch (error: any) {
    console.error("Error creating customer note:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
