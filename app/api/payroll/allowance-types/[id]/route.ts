import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import type { MapsToBucket } from "@/lib/payroll/allowanceTypeMapping"

const BUCKETS = new Set<MapsToBucket>(["regular", "bonus", "overtime"])

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(params)
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

    const { data: row, error: fetchErr } = await supabase
      .from("payroll_allowance_types")
      .select("*")
      .eq("id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (fetchErr || !row) {
      return NextResponse.json({ error: "Allowance type not found" }, { status: 404 })
    }

    const body = await request.json()
    const patch: Record<string, unknown> = {}

    const isSystem = Boolean(row.is_system)

    if (isSystem) {
      if (
        typeof body.name === "string" ||
        typeof body.code === "string" ||
        typeof body.maps_to_bucket === "string" ||
        typeof body.is_taxable === "boolean" ||
        typeof body.is_pensionable === "boolean" ||
        typeof body.default_recurring === "boolean"
      ) {
        return NextResponse.json(
          { error: "System allowance types cannot be edited except activation state" },
          { status: 400 }
        )
      }
      if (typeof body.is_active !== "boolean") {
        return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
      }
      patch.is_active = body.is_active
    } else {
      if (typeof body.name === "string") {
        const name = body.name.trim()
        if (!name) return NextResponse.json({ error: "Invalid name" }, { status: 400 })
        patch.name = name
      }
      if (typeof body.code === "string") {
        const c = body.code.trim().toLowerCase()
        patch.code = c.length > 0 ? c.slice(0, 64) : null
      }
      if (typeof body.description === "string") {
        patch.description = body.description.trim() || null
      }
      if (typeof body.maps_to_bucket === "string") {
        const b = body.maps_to_bucket.trim().toLowerCase() as MapsToBucket
        if (!BUCKETS.has(b)) {
          return NextResponse.json({ error: "Invalid maps_to_bucket" }, { status: 400 })
        }
        if (b !== row.maps_to_bucket) {
          const { count } = await supabase
            .from("allowances")
            .select("*", { count: "exact", head: true })
            .eq("allowance_type_id", id)
            .is("deleted_at", null)
          if ((count ?? 0) > 0) {
            return NextResponse.json(
              {
                error:
                  "Cannot change bucket while allowances reference this type. Create a new type instead.",
              },
              { status: 409 }
            )
          }
          patch.maps_to_bucket = b
        }
      }
      if (typeof body.is_taxable === "boolean") patch.is_taxable = body.is_taxable
      if (typeof body.is_pensionable === "boolean") patch.is_pensionable = body.is_pensionable
      if (typeof body.default_recurring === "boolean") patch.default_recurring = body.default_recurring
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active
      if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
        patch.sort_order = Math.floor(body.sort_order)
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    const { data: updated, error } = await supabase
      .from("payroll_allowance_types")
      .update(patch)
      .eq("id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .select()
      .single()

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "An active allowance type with this name already exists for this business" },
          { status: 409 }
        )
      }
      console.error("[allowance-types PATCH]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ allowanceType: updated })
  } catch (e: any) {
    console.error("[allowance-types PATCH]", e)
    return NextResponse.json(
      { error: e.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(params)
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

    const { data: row } = await supabase
      .from("payroll_allowance_types")
      .select("id, is_system")
      .eq("id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (!row) return NextResponse.json({ error: "Allowance type not found" }, { status: 404 })
    if (row.is_system) {
      return NextResponse.json({ error: "Cannot delete system allowance types" }, { status: 400 })
    }

    const { error } = await supabase
      .from("payroll_allowance_types")
      .update({
        deleted_at: new Date().toISOString(),
        is_active: false,
      })
      .eq("id", id)
      .eq("business_id", business.id)
      .is("deleted_at", null)

    if (error) {
      console.error("[allowance-types DELETE]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("[allowance-types DELETE]", e)
    return NextResponse.json(
      { error: e.message || "Internal server error" },
      { status: 500 }
    )
  }
}
