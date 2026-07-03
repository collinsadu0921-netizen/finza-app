import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { parseMaterialFormInput } from "@/lib/service/materialFormFields"

/**
 * POST /api/service/materials/inventory
 * Create material with optional starting quantity (setup_stock movement).
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

    const parsed = parseMaterialFormInput(body as Record<string, unknown>, { isCreate: true })
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const f = parsed.fields

    const { data: inserted, error: insertErr } = await supabase
      .from("service_material_inventory")
      .insert({
        business_id: business.id,
        name: f.name,
        sku: f.sku,
        unit: f.unit,
        quantity_on_hand: f.quantity_on_hand,
        average_cost: f.average_cost,
        reorder_level: f.reorder_level,
        is_active: f.is_active,
        default_cost_price: f.default_cost_price,
        default_selling_price: f.default_selling_price,
        is_billable: f.is_billable,
        sales_description: f.sales_description,
        sales_unit: f.sales_unit,
        sales_notes: f.sales_notes,
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

    if (f.quantity_on_hand > 0) {
      const { error: movErr } = await supabase.from("service_material_movements").insert({
        business_id: business.id,
        material_id: inserted.id,
        movement_type: "setup_stock",
        quantity: f.quantity_on_hand,
        unit_cost: f.average_cost,
        reason_code: "existing_stock",
        reference_id: null,
      })
      if (movErr) {
        console.error("service_material_movements insert:", movErr)
        await supabase.from("service_material_inventory").delete().eq("id", inserted.id)
        return NextResponse.json({ error: movErr.message }, { status: 500 })
      }
    }

    return NextResponse.json(
      { id: inserted.id, warnings: f.warnings.length > 0 ? f.warnings : undefined },
      { status: 201 }
    )
  } catch (err: unknown) {
    console.error("POST /api/service/materials/inventory:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
