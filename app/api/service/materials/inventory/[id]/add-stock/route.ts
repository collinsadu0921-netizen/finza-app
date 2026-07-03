import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { computeWeightedAverageCost } from "@/lib/service/materialFormFields"
import { isValidStockInReason } from "@/lib/service/materialMovementLabels"

/**
 * POST /api/service/materials/inventory/[id]/add-stock
 * Tenant "Add stock" — increases quantity, optional weighted cost update. No ledger.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: materialId } = await Promise.resolve(context.params)

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

    const { quantity, cost_price_per_unit, reason, movement_date, note } = body as Record<string, unknown>

    const qty = Number(quantity)
    if (isNaN(qty) || qty <= 0) {
      return NextResponse.json({ error: "Quantity added must be greater than 0" }, { status: 400 })
    }

    const reasonCode = typeof reason === "string" ? reason.trim() : ""
    if (!isValidStockInReason(reasonCode)) {
      return NextResponse.json({ error: "A valid reason is required" }, { status: 400 })
    }

    let unitCost: number | null = null
    if (cost_price_per_unit !== undefined && cost_price_per_unit !== null && cost_price_per_unit !== "") {
      const c = Number(cost_price_per_unit)
      if (isNaN(c) || c < 0) {
        return NextResponse.json({ error: "Cost price per unit must be a non-negative number" }, { status: 400 })
      }
      unitCost = c
    }

    const { data: material, error: loadErr } = await supabase
      .from("service_material_inventory")
      .select("id, business_id, quantity_on_hand, average_cost, default_cost_price")
      .eq("id", materialId)
      .eq("business_id", business.id)
      .maybeSingle()

    if (loadErr) {
      return NextResponse.json({ error: loadErr.message }, { status: 500 })
    }
    if (!material) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    const prevQty = Number(material.quantity_on_hand ?? 0)
    const prevCost = Number(material.average_cost ?? 0)
    const effectiveUnitCost = unitCost ?? (material.default_cost_price != null ? Number(material.default_cost_price) : null)
    const newQty = prevQty + qty
    const newAvgCost = computeWeightedAverageCost(prevQty, prevCost, qty, effectiveUnitCost)

    const updatePayload: Record<string, unknown> = {
      quantity_on_hand: newQty,
      average_cost: newAvgCost,
      updated_at: new Date().toISOString(),
    }
    if (unitCost !== null) {
      updatePayload.default_cost_price = unitCost
    }

    const { error: updateErr } = await supabase
      .from("service_material_inventory")
      .update(updatePayload)
      .eq("id", materialId)
      .eq("business_id", business.id)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    const noteText = typeof note === "string" && note.trim() ? note.trim() : null
    const movDate =
      typeof movement_date === "string" && movement_date.trim()
        ? movement_date.trim()
        : null

    const { error: movErr } = await supabase.from("service_material_movements").insert({
      business_id: business.id,
      material_id: materialId,
      movement_type: "stock_in",
      quantity: qty,
      unit_cost: effectiveUnitCost ?? prevCost,
      reason_code: reasonCode,
      note: noteText,
      movement_date: movDate,
      reference_id: null,
    })

    if (movErr) {
      console.error("add-stock movement failed:", movErr)
      return NextResponse.json({ error: movErr.message || "Stock updated but history failed" }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      quantity_on_hand: newQty,
      cost_price: newAvgCost,
    })
  } catch (err: unknown) {
    console.error("POST add-stock:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
