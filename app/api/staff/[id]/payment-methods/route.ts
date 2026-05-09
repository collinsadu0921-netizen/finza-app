import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission, requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { validateStaffPaymentMethodCreate } from "@/lib/staffPaymentMethods"

async function resolveStaffRow(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  staffId: string,
  businessId: string
) {
  return supabase
    .from("staff")
    .select("id, business_id")
    .eq("id", staffId)
    .eq("business_id", businessId)
    .single()
}

function trimNullable(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === "" ? null : s
}

/** Clear other defaults for this staff member (PostgreSQL partial unique requires at most one). */
async function clearOtherDefaults(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  staffId: string,
  businessId: string,
  exceptId?: string
) {
  let q = supabase
    .from("staff_payment_methods")
    .update({ is_default: false })
    .eq("staff_id", staffId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
  if (exceptId) q = q.neq("id", exceptId)
  await q
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: staffId } = await Promise.resolve(params)
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

    const canViewPayroll = await hasPermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_VIEW)
    const canManageStaff = await hasPermission(supabase, user.id, business.id, PERMISSIONS.STAFF_MANAGE)
    if (!canViewPayroll && !canManageStaff) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const { data: staff, error: staffErr } = await resolveStaffRow(supabase, staffId, business.id)
    if (staffErr || !staff) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 })
    }

    const { data: methods, error } = await supabase
      .from("staff_payment_methods")
      .select("*")
      .eq("staff_id", staffId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[payment-methods GET]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const list = methods || []
    return NextResponse.json({
      paymentMethods: list,
      default_payment_method: list.find((m) => m.is_default) ?? null,
    })
  } catch (e: any) {
    console.error("[payment-methods GET]", e)
    return NextResponse.json({ error: e.message || "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: staffId } = await Promise.resolve(params)
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

    const { data: staffRow, error: staffErr } = await resolveStaffRow(supabase, staffId, business.id)
    if (staffErr || !staffRow) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 })
    }

    const body = await request.json()
    const v = validateStaffPaymentMethodCreate(body)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

    const isDefault = Boolean(body.is_default)
    const methodType = v.method_type

    const row = {
      business_id: business.id,
      staff_id: staffId,
      method_type: methodType,
      provider_name: trimNullable(body.provider_name),
      bank_name: methodType === "bank" ? trimNullable(body.bank_name) : null,
      bank_code: methodType === "bank" ? trimNullable(body.bank_code) : null,
      branch_name: methodType === "bank" ? trimNullable(body.branch_name) : null,
      account_number: methodType === "bank" ? trimNullable(body.account_number) : null,
      account_name: trimNullable(body.account_name),
      momo_provider: methodType === "momo" ? trimNullable(body.momo_provider) : null,
      momo_number: methodType === "momo" ? trimNullable(body.momo_number) : null,
      is_default: isDefault,
      is_verified: false,
      verification_status: "unverified" as const,
    }

    if (methodType === "cash") {
      row.bank_name = null
      row.bank_code = null
      row.branch_name = null
      row.account_number = null
      row.momo_provider = null
      row.momo_number = null
    }
    if (methodType === "momo") {
      row.bank_name = null
      row.bank_code = null
      row.branch_name = null
      row.account_number = null
    }
    if (methodType === "bank") {
      row.momo_provider = null
      row.momo_number = null
    }

    if (isDefault) {
      await clearOtherDefaults(supabase, staffId, business.id)
    }

    const { data: created, error: insErr } = await supabase
      .from("staff_payment_methods")
      .insert(row)
      .select()
      .single()

    if (insErr) {
      console.error("[payment-methods POST]", insErr)
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({ paymentMethod: created }, { status: 201 })
  } catch (e: any) {
    console.error("[payment-methods POST]", e)
    return NextResponse.json({ error: e.message || "Internal server error" }, { status: 500 })
  }
}
