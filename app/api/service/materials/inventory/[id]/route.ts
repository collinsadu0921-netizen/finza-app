import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { parseMaterialBillableFields } from "@/lib/service/materialBillableFields"

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
      .select(
        "id, business_id, name, sku, unit, quantity_on_hand, average_cost, reorder_level, is_active, is_billable, sales_name, sales_description, default_selling_price, sales_unit, sales_tax_code, sales_notes"
      )
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

    const {
      name,
      sku,
      unit,
      average_cost,
      reorder_level,
      is_active,
      is_billable,
      sales_name,
      sales_description,
      default_selling_price,
      sales_unit,
      sales_tax_code,
      sales_notes,
    } = body as Record<string, unknown>

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

    const billableKeys = [
      "is_billable",
      "sales_name",
      "sales_description",
      "default_selling_price",
      "sales_unit",
      "sales_tax_code",
      "sales_notes",
    ] as const
    const hasBillablePatch = billableKeys.some((k) => Object.prototype.hasOwnProperty.call(body, k))
    if (hasBillablePatch) {
      const { data: existing, error: loadErr } = await supabase
        .from("service_material_inventory")
        .select(
          "unit, is_billable, sales_name, sales_description, default_selling_price, sales_unit, sales_tax_code, sales_notes"
        )
        .eq("id", id)
        .eq("business_id", business.id)
        .maybeSingle()

      if (loadErr) {
        return NextResponse.json({ error: loadErr.message }, { status: 500 })
      }
      if (!existing) {
        return NextResponse.json({ error: "Material not found" }, { status: 404 })
      }

      const merged = {
        is_billable: Object.prototype.hasOwnProperty.call(body, "is_billable")
          ? is_billable
          : existing.is_billable,
        sales_name: Object.prototype.hasOwnProperty.call(body, "sales_name")
          ? sales_name
          : existing.sales_name,
        sales_description: Object.prototype.hasOwnProperty.call(body, "sales_description")
          ? sales_description
          : existing.sales_description,
        default_selling_price: Object.prototype.hasOwnProperty.call(body, "default_selling_price")
          ? default_selling_price
          : existing.default_selling_price,
        sales_unit: Object.prototype.hasOwnProperty.call(body, "sales_unit")
          ? sales_unit
          : existing.sales_unit,
        sales_tax_code: Object.prototype.hasOwnProperty.call(body, "sales_tax_code")
          ? sales_tax_code
          : existing.sales_tax_code,
        sales_notes: Object.prototype.hasOwnProperty.call(body, "sales_notes")
          ? sales_notes
          : existing.sales_notes,
      }

      const stockUnit = (update.unit as string | undefined) ?? existing.unit
      const billableParsed = parseMaterialBillableFields(merged, { stockUnit })
      if (!billableParsed.ok) {
        return NextResponse.json({ error: billableParsed.error }, { status: 400 })
      }

      if (Object.prototype.hasOwnProperty.call(body, "is_billable")) {
        update.is_billable = billableParsed.fields.is_billable
      }
      if (Object.prototype.hasOwnProperty.call(body, "sales_name")) {
        update.sales_name = billableParsed.fields.sales_name
      }
      if (Object.prototype.hasOwnProperty.call(body, "sales_description")) {
        update.sales_description = billableParsed.fields.sales_description
      }
      if (Object.prototype.hasOwnProperty.call(body, "default_selling_price")) {
        update.default_selling_price = billableParsed.fields.default_selling_price
      }
      if (Object.prototype.hasOwnProperty.call(body, "sales_unit")) {
        update.sales_unit = billableParsed.fields.sales_unit
      }
      if (Object.prototype.hasOwnProperty.call(body, "sales_tax_code")) {
        update.sales_tax_code = billableParsed.fields.sales_tax_code
      }
      if (Object.prototype.hasOwnProperty.call(body, "sales_notes")) {
        update.sales_notes = billableParsed.fields.sales_notes
      }

      if (billableParsed.fields.is_billable) {
        const price =
          update.default_selling_price !== undefined
            ? update.default_selling_price
            : existing.default_selling_price
        if (price == null) {
          return NextResponse.json(
            { error: "default_selling_price is required when material is billable" },
            { status: 400 }
          )
        }
        const unitResolved =
          (update.sales_unit as string | null | undefined) ??
          existing.sales_unit ??
          stockUnit
        if (!unitResolved || !String(unitResolved).trim()) {
          return NextResponse.json(
            { error: "sales_unit is required when material is billable (set stock unit or sales unit)" },
            { status: 400 }
          )
        }
      }
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
