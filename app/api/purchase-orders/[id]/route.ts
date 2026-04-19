import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

const PAYMENT_STATES = new Set(["unpaid", "part_paid", "paid"])

/**
 * PATCH /api/purchase-orders/[id]
 * Notes, payment tracking, cancel buy list.
 */
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

    const body = await request.json().catch(() => ({}))
    const updates: Record<string, unknown> = {}

    if (typeof body.supplier_order_note === "string") {
      updates.supplier_order_note = body.supplier_order_note.trim() || null
    }
    if (body.payment_state !== undefined) {
      const ps = String(body.payment_state || "").trim()
      if (!PAYMENT_STATES.has(ps)) {
        return NextResponse.json({ error: "Invalid payment_state" }, { status: 400 })
      }
      updates.payment_state = ps
    }
    if (body.status === "cancelled") {
      updates.status = "cancelled"
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    const { data: existing, error: exErr } = await supabase
      .from("purchase_orders")
      .select("id, status")
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (exErr || !existing) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 })
    }

    if (updates.status === "cancelled") {
      const st = String(existing.status)
      if (["received", "paid", "cancelled"].includes(st)) {
        return NextResponse.json({ error: `Cannot cancel when status is ${st}.` }, { status: 400 })
      }
    }

    const { data: updated, error: upErr } = await supabase
      .from("purchase_orders")
      .update(updates)
      .eq("id", id)
      .eq("business_id", business.id)
      .select()
      .single()

    if (upErr || !updated) {
      return NextResponse.json({ error: upErr?.message || "Update failed" }, { status: 500 })
    }

    return NextResponse.json({ purchase_order: updated })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * GET /api/purchase-orders/[id]
 * Get purchase order details with items
 */
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

    const { data: purchaseOrder, error } = await supabase
      .from("purchase_orders")
      .select(`
        *,
        supplier:suppliers(id, name, phone, email),
        created_by_user:users!purchase_orders_created_by_fkey(id, full_name, email),
        received_by_user:users!purchase_orders_received_by_fkey(id, full_name, email),
        items:purchase_order_items(
          *,
          product:products(id, name, price)
        )
      `)
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (error || !purchaseOrder) {
      return NextResponse.json(
        { error: "Purchase order not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ purchase_order: purchaseOrder })
  } catch (error: any) {
    console.error("Error in GET /api/purchase-orders/[id]:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
