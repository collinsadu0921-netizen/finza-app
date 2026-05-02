import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/**
 * POST /api/service/materials/inventory
 * Create inventory row and optional initial stock movement.
 */
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

    const denied = await enforceServiceIndustryMinTier(supabase, user.id, business.id, "professional")
    if (denied) return denied

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const {
      name,
      sku = null,
      unit,
      reorder_level = 0,
      initial_quantity = 0,
      is_active = true,
    } = body as Record<string, unknown>

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }
    if (!unit || typeof unit !== "string" || !unit.trim()) {
      return NextResponse.json({ error: "unit is required" }, { status: 400 })
    }

    const reorder = Number(reorder_level)
    if (isNaN(reorder) || reorder < 0) {
      return NextResponse.json({ error: "reorder_level must be a non-negative number" }, { status: 400 })
    }
    const initialQty = Number(initial_quantity)
    if (isNaN(initialQty) || initialQty < 0) {
      return NextResponse.json({ error: "initial_quantity must be a non-negative number" }, { status: 400 })
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("service_material_inventory")
      .insert({
        business_id: business.id,
        name: name.trim(),
        sku: sku != null && String(sku).trim() ? String(sku).trim() : null,
        unit: unit.trim(),
        quantity_on_hand: initialQty,
        average_cost: 0,
        reorder_level: reorder,
        is_active: Boolean(is_active),
      })
      .select("id")
      .single()

    if (insertErr || !inserted) {
      console.error("service_material_inventory insert:", insertErr)
      return NextResponse.json(
        { error: insertErr?.message || "Failed to create material" },
        { status: 500 }
      )
    }

    if (initialQty > 0) {
      const { error: movErr } = await supabase.from("service_material_movements").insert({
        business_id: business.id,
        material_id: inserted.id,
        movement_type: "adjustment",
        quantity: initialQty,
        unit_cost: 0,
        reference_id: null,
      })
      if (movErr) {
        console.error("service_material_movements insert:", movErr)
        return NextResponse.json({ error: movErr.message }, { status: 500 })
      }
    }

    return NextResponse.json({ id: inserted.id }, { status: 201 })
  } catch (err: unknown) {
    console.error("POST /api/service/materials/inventory:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
