import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import type { MapsToBucket } from "@/lib/payroll/allowanceTypeMapping"

const BUCKETS: MapsToBucket[] = ["regular", "bonus", "overtime"]

function normalizeMapsToBucket(raw: unknown): MapsToBucket {
  const s = String(raw ?? "regular").trim().toLowerCase()
  return BUCKETS.includes(s as MapsToBucket) ? (s as MapsToBucket) : "regular"
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDenied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDenied) return tierDenied

    const { allowed: canViewPayroll } = await requirePermission(
      supabase,
      user.id,
      business.id,
      PERMISSIONS.PAYROLL_VIEW
    )
    const { allowed: canManageStaff } = await requirePermission(
      supabase,
      user.id,
      business.id,
      PERMISSIONS.STAFF_MANAGE
    )
    if (!canViewPayroll && !canManageStaff) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    /** When true, only types eligible for new allowances (active + not soft-deleted). */
    const activeOnly = searchParams.get("activeOnly") === "true"

    let q = supabase
      .from("payroll_allowance_types")
      .select("*")
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })

    if (activeOnly) {
      q = q.eq("is_active", true)
    }

    const { data, error } = await q
    if (error) {
      console.error("[allowance-types GET]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ allowanceTypes: data ?? [] })
  } catch (e: any) {
    console.error("[allowance-types GET]", e)
    return NextResponse.json(
      { error: e.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDenied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (tierDenied) return tierDenied

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.STAFF_MANAGE)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const body = await request.json()
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name || name.length > 256) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 })
    }

    const codeRaw = typeof body.code === "string" ? body.code.trim().toLowerCase() : ""
    const code = codeRaw.length > 0 ? codeRaw.slice(0, 64) : null
    const mapsBucket = normalizeMapsToBucket(body.maps_to_bucket)

    const { data: created, error } = await supabase
      .from("payroll_allowance_types")
      .insert({
        business_id: business.id,
        name,
        code,
        description: typeof body.description === "string" ? body.description.trim() || null : null,
        maps_to_bucket: mapsBucket,
        is_taxable: typeof body.is_taxable === "boolean" ? body.is_taxable : true,
        is_pensionable:
          typeof body.is_pensionable === "boolean" ? body.is_pensionable : false,
        default_recurring:
          typeof body.default_recurring === "boolean" ? body.default_recurring : true,
        is_system: false,
        is_active: typeof body.is_active === "boolean" ? body.is_active : true,
        sort_order: typeof body.sort_order === "number" && Number.isFinite(body.sort_order) ? Math.floor(body.sort_order) : 0,
      })
      .select()
      .single()

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "An active allowance type with this name already exists for this business" },
          { status: 409 }
        )
      }
      console.error("[allowance-types POST]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ allowanceType: created }, { status: 201 })
  } catch (e: any) {
    console.error("[allowance-types POST]", e)
    return NextResponse.json(
      { error: e.message || "Internal server error" },
      { status: 500 }
    )
  }
}
