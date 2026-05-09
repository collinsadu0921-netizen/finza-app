import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { normalizeAllowanceType, ALLOWANCE_TYPES } from "@/lib/payrollTypes"
import { deriveLegacyAllowanceType } from "@/lib/payroll/allowanceTypeMapping"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; allowanceId: string }> | { id: string; allowanceId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const { id: staffId, allowanceId } = resolvedParams

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

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.STAFF_MANAGE)
    if (!allowed) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const body = await request.json()
    const { allowance_type_id, type, amount, recurring, description } = body as {
      allowance_type_id?: string | null
      type?: string
      amount?: number
      recurring?: boolean
      description?: string | null
    }

    const updateData: Record<string, unknown> = {}
    const hasExplicitTypeId = Object.prototype.hasOwnProperty.call(body, "allowance_type_id")

    if (hasExplicitTypeId) {
      const raw = allowance_type_id
      if (raw === null || raw === "") {
        updateData.allowance_type_id = null
        if (type !== undefined) {
          const normalizedType = normalizeAllowanceType(type)
          if (normalizedType === null) {
            return NextResponse.json(
              {
                error: "Invalid allowance type",
                code: "INVALID_ALLOWANCE_TYPE",
                allowed: ALLOWANCE_TYPES,
              },
              { status: 400 }
            )
          }
          updateData.type = normalizedType
        }
      } else {
        const idStr = String(raw).trim()
        const { data: patRow, error: patErr } = await supabase
          .from("payroll_allowance_types")
          .select("*")
          .eq("id", idStr)
          .eq("business_id", business.id)
          .is("deleted_at", null)
          .single()

        if (patErr || !patRow) {
          return NextResponse.json({ error: "Allowance type not found" }, { status: 400 })
        }
        if (!patRow.is_active) {
          return NextResponse.json(
            { error: "Cannot attach an inactive allowance type" },
            { status: 400 }
          )
        }
        updateData.allowance_type_id = idStr
        updateData.type = deriveLegacyAllowanceType(patRow)
      }
    } else if (type !== undefined) {
      const normalizedType = normalizeAllowanceType(type)
      if (normalizedType === null) {
        return NextResponse.json(
          {
            error: "Invalid allowance type",
            code: "INVALID_ALLOWANCE_TYPE",
            allowed: ALLOWANCE_TYPES,
          },
          { status: 400 }
        )
      }
      updateData.type = normalizedType
      updateData.allowance_type_id = null
    }

    if (amount !== undefined) updateData.amount = Number(amount)
    if (recurring !== undefined) updateData.recurring = recurring
    if (description !== undefined) {
      updateData.description = typeof description === "string" ? description.trim() || null : null
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    const { data: allowance, error } = await supabase
      .from("allowances")
      .update(updateData)
      .eq("id", allowanceId)
      .eq("staff_id", staffId)
      .select()
      .single()

    if (error) {
      console.error("Error updating allowance:", error)
      return NextResponse.json({ error: error.message || "Failed to update allowance" }, { status: 500 })
    }

    return NextResponse.json({ allowance })
  } catch (error: any) {
    console.error("Error updating allowance:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; allowanceId: string }> | { id: string; allowanceId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const { id: staffId, allowanceId } = resolvedParams

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

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.STAFF_MANAGE)
    if (!allowed) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const { error } = await supabase
      .from("allowances")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", allowanceId)
      .eq("staff_id", staffId)

    if (error) {
      console.error("Error deleting allowance:", error)
      return NextResponse.json({ error: error.message || "Failed to delete allowance" }, { status: 500 })
    }

    return NextResponse.json({ message: "Allowance deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting allowance:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
