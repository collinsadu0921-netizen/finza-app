import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/**
 * GET /api/service/materials/workspace
 * Inventory rows plus last movement metadata per material (materials list page).
 */
export async function GET() {
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

    const { data: materials, error: matErr } = await supabase
      .from("service_material_inventory")
      .select("id, name, sku, unit, quantity_on_hand, average_cost, reorder_level, is_active")
      .eq("business_id", business.id)
      .order("name", { ascending: true })

    if (matErr) {
      return NextResponse.json({ error: matErr.message }, { status: 500 })
    }

    const list = materials ?? []
    const lastByMaterial: Record<
      string,
      { created_at: string; movement_type: string; reference_id: string | null }
    > = {}

    if (list.length > 0) {
      const ids = list.map((m) => m.id)
      const { data: movements, error: movErr } = await supabase
        .from("service_material_movements")
        .select("material_id, created_at, movement_type, reference_id")
        .eq("business_id", business.id)
        .in("material_id", ids)
        .order("created_at", { ascending: false })

      if (movErr) {
        return NextResponse.json({ error: movErr.message }, { status: 500 })
      }

      for (const m of (movements ?? []) as {
        material_id: string
        created_at: string
        movement_type: string
        reference_id: string | null
      }[]) {
        if (!lastByMaterial[m.material_id]) {
          lastByMaterial[m.material_id] = {
            created_at: m.created_at,
            movement_type: m.movement_type,
            reference_id: m.reference_id ?? null,
          }
        }
      }
    }

    const rows = list.map((m) => {
      const last = lastByMaterial[m.id]
      return {
        ...m,
        last_movement_at: last?.created_at ?? null,
        last_movement_type: last?.movement_type ?? null,
        last_movement_reference_id: last?.reference_id ?? null,
      }
    })

    return NextResponse.json({ rows })
  } catch (err: unknown) {
    console.error("GET /api/service/materials/workspace:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
