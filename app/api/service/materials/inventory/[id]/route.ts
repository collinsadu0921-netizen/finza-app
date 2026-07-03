import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { parseMaterialFormInput } from "@/lib/service/materialFormFields"

const MATERIAL_SELECT =
  "id, business_id, name, sku, unit, quantity_on_hand, average_cost, default_cost_price, reorder_level, is_active, is_billable, sales_description, default_selling_price, sales_unit, sales_tax_code, sales_notes"

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
      .select(MATERIAL_SELECT)
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
 * Metadata edit (quantity changes via Add stock / Use stock).
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

    const { data: existing, error: loadErr } = await supabase
      .from("service_material_inventory")
      .select("id, quantity_on_hand, average_cost")
      .eq("id", id)
      .eq("business_id", business.id)
      .maybeSingle()

    if (loadErr) {
      return NextResponse.json({ error: loadErr.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    const parsed = parseMaterialFormInput({
      ...body,
      quantity_available: existing.quantity_on_hand,
    })
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const f = parsed.fields

    const update: Record<string, unknown> = {
      name: f.name,
      sku: f.sku,
      unit: f.unit,
      reorder_level: f.reorder_level,
      is_active: f.is_active,
      default_cost_price: f.default_cost_price,
      default_selling_price: f.default_selling_price,
      is_billable: f.is_billable,
      sales_description: f.sales_description,
      sales_unit: f.sales_unit,
      sales_notes: f.sales_notes,
    }

    if (f.default_cost_price !== null && Number(existing.quantity_on_hand ?? 0) === 0) {
      update.average_cost = 0
    } else if (f.default_cost_price !== null && Number(existing.average_cost ?? 0) === 0) {
      update.average_cost = f.default_cost_price
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

    return NextResponse.json({ ok: true, warnings: f.warnings.length > 0 ? f.warnings : undefined })
  } catch (err: unknown) {
    console.error("PATCH /api/service/materials/inventory/[id]:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
