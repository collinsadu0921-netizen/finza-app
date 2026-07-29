import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  mapBillableMaterialRows,
  parseBillableListLimit,
  sanitizeBillableListSearchQuery,
} from "@/lib/service/materialBillableList"

/**
 * Internal select includes sku so PostgREST search filters are valid.
 * mapBillableMaterialRows never exposes sku/cost fields in the response.
 */
const BILLABLE_SELECT =
  "id, name, sales_name, sales_description, unit, sales_unit, default_selling_price, sales_tax_code, quantity_on_hand, is_active, is_billable, sku"

/**
 * GET /api/service/materials/billable-list
 * Active materials with selling prices for invoice/quote/proforma pickers.
 * Query: business_id (preferred), q, limit
 * Does not expose cost fields.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const requestedBusinessId =
      searchParams.get("business_id")?.trim() ||
      searchParams.get("businessId")?.trim() ||
      null

    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      requestedBusinessId
    )
    if (!scope.ok) {
      const code =
        scope.status === 403
          ? "FORBIDDEN_BUSINESS"
          : scope.status === 404
            ? "BUSINESS_NOT_FOUND"
            : "MATERIAL_LIST_FAILED"
      return NextResponse.json(
        { error: scope.error, code },
        { status: scope.status }
      )
    }

    const businessId = scope.businessId

    const denied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      businessId,
      "professional"
    )
    if (denied) return denied

    const limit = parseBillableListLimit(searchParams.get("limit"))
    const qRaw = (searchParams.get("q") || "").trim()
    const q = qRaw ? sanitizeBillableListSearchQuery(qRaw) : ""

    const [activeCount, billableCount, withPriceCount, listResult] = await Promise.all([
      supabase
        .from("service_material_inventory")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("is_active", true),
      supabase
        .from("service_material_inventory")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("is_active", true)
        .eq("is_billable", true),
      supabase
        .from("service_material_inventory")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("is_active", true)
        .eq("is_billable", true)
        .not("default_selling_price", "is", null),
      (() => {
        let query = supabase
          .from("service_material_inventory")
          .select(BILLABLE_SELECT)
          .eq("business_id", businessId)
          .eq("is_active", true)
          .eq("is_billable", true)
          .not("default_selling_price", "is", null)
          .order("name", { ascending: true })

        if (q) {
          query = query.or(
            `name.ilike.%${q}%,sales_name.ilike.%${q}%,sales_description.ilike.%${q}%,sku.ilike.%${q}%`
          )
        }
        return query.limit(limit)
      })(),
    ])

    if (listResult.error) {
      console.error("GET /api/service/materials/billable-list query:", listResult.error.message)
      return NextResponse.json(
        { error: "Materials could not be loaded.", code: "MATERIAL_LIST_FAILED" },
        { status: 500 }
      )
    }

    const materials = mapBillableMaterialRows(
      (listResult.data ?? []) as Parameters<typeof mapBillableMaterialRows>[0]
    )

    return NextResponse.json({
      materials,
      businessId,
      eligibility: {
        active: activeCount.count ?? 0,
        billable: billableCount.count ?? 0,
        withSellingPrice: withPriceCount.count ?? 0,
      },
    })
  } catch (err: unknown) {
    console.error("GET /api/service/materials/billable-list:", err)
    return NextResponse.json(
      {
        error: "Materials could not be loaded.",
        code: "MATERIAL_LIST_FAILED",
      },
      { status: 500 }
    )
  }
}
