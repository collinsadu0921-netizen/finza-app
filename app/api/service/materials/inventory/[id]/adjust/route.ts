import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/**
 * POST /api/service/materials/inventory/[id]/adjust
 * Apply quantity delta with movement row (matches client adjust page behavior).
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

    const { direction, amount } = body as { direction?: string; amount?: unknown }
    if (direction !== "increase" && direction !== "decrease") {
      return NextResponse.json({ error: "direction must be increase or decrease" }, { status: 400 })
    }

    const amt = Number(amount)
    if (isNaN(amt) || amt <= 0) {
      return NextResponse.json({ error: "amount must be a number greater than 0" }, { status: 400 })
    }

    const { data: material, error: loadErr } = await supabase
      .from("service_material_inventory")
      .select("id, business_id, quantity_on_hand, average_cost")
      .eq("id", materialId)
      .eq("business_id", business.id)
      .maybeSingle()

    if (loadErr) {
      return NextResponse.json({ error: loadErr.message }, { status: 500 })
    }
    if (!material) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    const qty = Number(material.quantity_on_hand ?? 0)
    let newQty: number
    if (direction === "increase") {
      newQty = qty + amt
    } else {
      if (qty < amt) {
        return NextResponse.json(
          { error: `Insufficient stock. On hand: ${qty}. Cannot decrease by ${amt}.` },
          { status: 400 }
        )
      }
      newQty = qty - amt
    }

    const { error: uErr } = await supabase
      .from("service_material_inventory")
      .update({ quantity_on_hand: newQty })
      .eq("id", materialId)
      .eq("business_id", business.id)

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 })
    }

    const movementQuantity = direction === "increase" ? amt : -amt
    const { error: mErr } = await supabase.from("service_material_movements").insert({
      business_id: business.id,
      material_id: materialId,
      movement_type: "adjustment",
      quantity: movementQuantity,
      unit_cost: Number(material.average_cost ?? 0),
    })

    if (mErr) {
      console.error("adjust movement insert failed:", mErr)
      return NextResponse.json(
        { error: mErr.message || "Stock updated but movement log failed" },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, quantity_on_hand: newQty })
  } catch (err: unknown) {
    console.error("POST /api/service/materials/inventory/[id]/adjust:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
