import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * POST /api/service/materials/add-stock
 * Add stock to a service material (purchase flow).
 * Updates quantity_on_hand, average_cost, and inserts service_material_movements (purchase).
 * Does NOT post to ledger (per STEP 3).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const { material_id, quantity, unit_cost } = body as { material_id?: string; quantity?: number; unit_cost?: number }

    if (!material_id) {
      return NextResponse.json({ error: "material_id is required" }, { status: 400 })
    }
    const qty = Number(quantity)
    if (isNaN(qty) || qty <= 0) {
      return NextResponse.json({ error: "quantity must be a positive number" }, { status: 400 })
    }
    const cost = Number(unit_cost ?? 0)
    if (isNaN(cost) || cost < 0) {
      return NextResponse.json({ error: "unit_cost must be a non-negative number" }, { status: 400 })
    }

    const { data: material, error: fetchErr } = await supabase
      .from("service_material_inventory")
      .select("id, business_id, quantity_on_hand, average_cost")
      .eq("id", material_id)
      .eq("business_id", business.id)
      .single()

    if (fetchErr || !material) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    const prevQty = Number(material.quantity_on_hand ?? 0)
    const prevCost = Number(material.average_cost ?? 0)
    const newQty = prevQty + qty
    const newAvgCost = newQty === 0 ? 0 : (prevQty * prevCost + qty * cost) / newQty

    const { error: updateErr } = await supabase
      .from("service_material_inventory")
      .update({
        quantity_on_hand: newQty,
        average_cost: newAvgCost,
        updated_at: new Date().toISOString(),
      })
      .eq("id", material_id)
      .eq("business_id", business.id)

    if (updateErr) {
      console.error("Add stock update error:", updateErr)
      return NextResponse.json({ error: "Failed to update stock" }, { status: 500 })
    }

    const { error: movErr } = await supabase.from("service_material_movements").insert({
      business_id: business.id,
      material_id,
      movement_type: "purchase",
      quantity: qty,
      unit_cost: cost,
      reference_id: null,
    })

    if (movErr) {
      console.error("Add stock movement insert error:", movErr)
      return NextResponse.json({ error: "Failed to record movement" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      quantity_on_hand: newQty,
      average_cost: newAvgCost,
    })
  } catch (err: any) {
    console.error("Add stock error:", err)
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    )
  }
}
