import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/**
 * GET /api/service/materials/workspace
 * Inventory rows plus last movement metadata per material (materials list page).
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

    const denied = await enforceServiceIndustryMinTier(supabase, user.id, business.id, "professional")
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const search = (searchParams.get("search") || "").trim()
    const status = (searchParams.get("status") || "all").trim()
    const stock = (searchParams.get("stock") || "all").trim()
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
    const limitRaw = Number.parseInt(searchParams.get("limit") || "25", 10) || 25
    const limit = Math.min(100, Math.max(1, limitRaw))
    const from = (page - 1) * limit
    const to = from + limit - 1

    let materialQuery = supabase
      .from("service_material_inventory")
      .select("id, name, sku, unit, quantity_on_hand, average_cost, reorder_level, is_active", {
        count: "exact",
      })
      .eq("business_id", business.id)

    if (search) {
      materialQuery = materialQuery.or(`name.ilike.%${search}%,sku.ilike.%${search}%`)
    }
    if (status === "active") materialQuery = materialQuery.eq("is_active", true)
    if (status === "inactive") materialQuery = materialQuery.eq("is_active", false)
    let materials: Array<{
      id: string
      name: string
      sku: string | null
      unit: string
      quantity_on_hand: number
      average_cost: number
      reorder_level: number
      is_active: boolean
    }> = []
    let count = 0
    let matErr: { message?: string } | null = null

    if (stock === "all") {
      const result = await materialQuery.order("name", { ascending: true }).range(from, to)
      materials = (result.data ?? []) as typeof materials
      count = result.count ?? 0
      matErr = result.error
    } else {
      const prefiltered = await materialQuery
        .select("id, name, sku, unit, quantity_on_hand, average_cost, reorder_level, is_active")
        .order("name", { ascending: true })
      if (prefiltered.error) {
        matErr = prefiltered.error
      } else {
        const scoped = ((prefiltered.data ?? []) as typeof materials).filter((r) => {
          const isLow = r.is_active && Number(r.reorder_level) > 0 && Number(r.quantity_on_hand) <= Number(r.reorder_level)
          return stock === "low" ? isLow : !isLow
        })
        count = scoped.length
        materials = scoped.slice(from, to + 1)
      }
    }

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

    const [{ count: totalItems }, { count: activeItems }, { data: allForStock }, { data: allForValue }] = await Promise.all([
      supabase
        .from("service_material_inventory")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id),
      supabase
        .from("service_material_inventory")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id)
        .eq("is_active", true),
      supabase
        .from("service_material_inventory")
        .select("quantity_on_hand, reorder_level, is_active")
        .eq("business_id", business.id),
      supabase
        .from("service_material_inventory")
        .select("quantity_on_hand, average_cost")
        .eq("business_id", business.id),
    ])

    const lowStockItems = (allForStock || []).filter(
      (r) => r.is_active && Number(r.reorder_level) > 0 && Number(r.quantity_on_hand) <= Number(r.reorder_level)
    ).length
    const totalValue = (allForValue || []).reduce(
      (sum, row) => sum + Number(row.quantity_on_hand || 0) * Number(row.average_cost || 0),
      0
    )

    const totalCount = count ?? 0
    return NextResponse.json({
      rows,
      pagination: {
        page,
        pageSize: limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
      summary: {
        totalItems: totalItems ?? 0,
        activeItems: activeItems ?? 0,
        lowStockItems,
        totalValue,
      },
    })
  } catch (err: unknown) {
    console.error("GET /api/service/materials/workspace:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
