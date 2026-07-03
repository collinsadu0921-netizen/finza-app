import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  mapBillableMaterialRows,
  parseBillableListLimit,
  sanitizeBillableListSearchQuery,
} from "@/lib/service/materialBillableList"

const BILLABLE_SELECT =
  "id, name, sales_name, sales_description, unit, sales_unit, default_selling_price, sales_tax_code, quantity_on_hand, is_active, is_billable"

/**
 * GET /api/service/materials/billable-list
 * Active materials with selling prices for future invoice/quote/proforma pickers.
 * Does not expose cost fields.
 */
export async function GET(request: NextRequest) {
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

    const denied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const limit = parseBillableListLimit(searchParams.get("limit"))
    const qRaw = (searchParams.get("q") || "").trim()
    const q = qRaw ? sanitizeBillableListSearchQuery(qRaw) : ""

    let query = supabase
      .from("service_material_inventory")
      .select(BILLABLE_SELECT)
      .eq("business_id", business.id)
      .eq("is_active", true)
      .eq("is_billable", true)
      .not("default_selling_price", "is", null)
      .order("name", { ascending: true })

    if (q) {
      query = query.or(
        `name.ilike.%${q}%,sales_name.ilike.%${q}%,sales_description.ilike.%${q}%,sku.ilike.%${q}%`
      )
    }

    const { data, error } = await query.limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const materials = mapBillableMaterialRows((data ?? []) as Parameters<typeof mapBillableMaterialRows>[0])

    return NextResponse.json({ materials })
  } catch (err: unknown) {
    console.error("GET /api/service/materials/billable-list:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
