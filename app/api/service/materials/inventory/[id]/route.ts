import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/**
 * GET /api/service/materials/inventory/[id]
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(context.params)

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

    const { data, error } = await supabase
      .from("service_material_inventory")
      .select("id, business_id, name, sku, unit, quantity_on_hand, average_cost, reorder_level, is_active")
      .eq("id", id)
      .eq("business_id", business.id)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    return NextResponse.json({ material: data })
  } catch (err: unknown) {
    console.error("GET /api/service/materials/inventory/[id]:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/service/materials/inventory/[id]
 * Metadata edit (not quantity — use /adjust).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(context.params)

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

    const { name, sku, unit, average_cost, reorder_level, is_active } = body as Record<string, unknown>

    const update: Record<string, unknown> = {}
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 })
      }
      update.name = name.trim()
    }
    if (sku !== undefined) {
      update.sku = sku != null && String(sku).trim() ? String(sku).trim() : null
    }
    if (unit !== undefined) {
      if (typeof unit !== "string" || !unit.trim()) {
        return NextResponse.json({ error: "unit cannot be empty" }, { status: 400 })
      }
      update.unit = unit.trim()
    }
    if (average_cost !== undefined) {
      const v = Number(average_cost)
      if (isNaN(v) || v < 0) {
        return NextResponse.json({ error: "average_cost must be a non-negative number" }, { status: 400 })
      }
      update.average_cost = v
    }
    if (reorder_level !== undefined) {
      const v = Number(reorder_level)
      if (isNaN(v) || v < 0) {
        return NextResponse.json({ error: "reorder_level must be a non-negative number" }, { status: 400 })
      }
      update.reorder_level = v
    }
    if (is_active !== undefined) {
      update.is_active = Boolean(is_active)
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 })
    }

    const { data: row, error } = await supabase
      .from("service_material_inventory")
      .update(update)
      .eq("id", id)
      .eq("business_id", business.id)
      .select("id")
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!row) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error("PATCH /api/service/materials/inventory/[id]:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
