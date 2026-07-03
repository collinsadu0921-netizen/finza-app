import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  movementActionLabel,
  movementReasonLabel,
} from "@/lib/service/materialMovementLabels"

/**
 * GET /api/service/materials/inventory/[id]/movements
 * Stock history for a material (tenant-facing labels).
 */
export async function GET(
  _request: Request,
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

    const { data: material, error: matErr } = await supabase
      .from("service_material_inventory")
      .select("id, name, unit")
      .eq("id", materialId)
      .eq("business_id", business.id)
      .maybeSingle()

    if (matErr) {
      return NextResponse.json({ error: matErr.message }, { status: 500 })
    }
    if (!material) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    const { data: rows, error: movErr } = await supabase
      .from("service_material_movements")
      .select(
        "id, movement_type, quantity, unit_cost, reason_code, note, movement_date, created_at, reference_id"
      )
      .eq("business_id", business.id)
      .eq("material_id", materialId)
      .order("created_at", { ascending: false })
      .limit(200)

    if (movErr) {
      return NextResponse.json({ error: movErr.message }, { status: 500 })
    }

    const movements = (rows ?? []).map((r) => ({
      id: r.id,
      date: r.movement_date ?? r.created_at,
      action: movementActionLabel(r.movement_type, r.reason_code),
      quantity: Number(r.quantity),
      cost: Number(r.unit_cost ?? 0),
      reason: movementReasonLabel(r.reason_code),
      note: r.note ?? null,
      reference_id: r.reference_id ?? null,
    }))

    return NextResponse.json({ material, movements })
  } catch (err: unknown) {
    console.error("GET movements:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
