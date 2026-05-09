import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { normalizeAllowanceType, ALLOWANCE_TYPES } from "@/lib/payrollTypes"
import { deriveLegacyAllowanceType } from "@/lib/payroll/allowanceTypeMapping"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const staffId = resolvedParams.id

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

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.STAFF_MANAGE)
    if (!allowed) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const { data: staff } = await supabase
      .from("staff")
      .select("id")
      .eq("id", staffId)
      .eq("business_id", business.id)
      .single()

    if (!staff) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 })
    }

    const body = await request.json()
    const { allowance_type_id, type, amount, recurring, description } = body as {
      allowance_type_id?: string | null
      type?: string
      amount?: number
      recurring?: boolean
      description?: string | null
    }

    if (amount === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    let allowanceTypeId: string | null =
      allowance_type_id && String(allowance_type_id).trim() !== ""
        ? String(allowance_type_id).trim()
        : null

    let normalizedType: ReturnType<typeof normalizeAllowanceType>
    let defaultRecurring = true

    if (allowanceTypeId) {
      const { data: patRow, error: patErr } = await supabase
        .from("payroll_allowance_types")
        .select("*")
        .eq("id", allowanceTypeId)
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .single()

      if (patErr || !patRow) {
        return NextResponse.json({ error: "Allowance type not found" }, { status: 400 })
      }
      if (!patRow.is_active) {
        return NextResponse.json(
          { error: "Cannot use an inactive allowance type for new allowances" },
          { status: 400 }
        )
      }
      normalizedType = deriveLegacyAllowanceType(patRow)
      defaultRecurring = Boolean(patRow.default_recurring)
    } else {
      normalizedType = normalizeAllowanceType(type)
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
      allowanceTypeId = null
    }

    const recurringEffective = recurring !== undefined ? Boolean(recurring) : defaultRecurring

    const { data: allowance, error } = await supabase
      .from("allowances")
      .insert({
        staff_id: staffId,
        allowance_type_id: allowanceTypeId,
        type: normalizedType,
        amount: Number(amount),
        recurring: recurringEffective,
        description: typeof description === "string" ? description.trim() || null : null,
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating allowance:", error)
      return NextResponse.json({ error: error.message || "Failed to create allowance" }, { status: 500 })
    }

    return NextResponse.json({ allowance }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating allowance:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
