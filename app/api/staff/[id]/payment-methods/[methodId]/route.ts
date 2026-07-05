import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { normalizeMethodType, validateStaffPaymentMethodCreate } from "@/lib/staffPaymentMethods"

function trimNullable(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === "" ? null : s
}

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; methodId: string }> | { id: string; methodId: string } }
) {
  try {
    const { id: staffId, methodId } = await Promise.resolve(params)

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

    const { data: existing, error: exErr } = await supabase
      .from("staff_payment_methods")
      .select("*")
      .eq("id", methodId)
      .eq("staff_id", staffId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (exErr || !existing) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 })
    }

    const patch = await request.json()
    if ("is_verified" in patch || "verification_status" in patch) {
      return NextResponse.json(
        { error: "Verification fields cannot be changed from this endpoint." },
        { status: 400 }
      )
    }

    const existingTypeNorm = normalizeMethodType(existing.method_type)
    if (!existingTypeNorm) {
      return NextResponse.json({ error: "Stored payment method is invalid." }, { status: 500 })
    }

    const nextTypeResolved =
      patch.method_type !== undefined ? normalizeMethodType(patch.method_type) : existingTypeNorm
    if (patch.method_type !== undefined && !nextTypeResolved) {
      return NextResponse.json({ error: "Invalid method_type." }, { status: 400 })
    }
    const finalType = nextTypeResolved ?? existingTypeNorm

    const mergedForValidation = {
      method_type: finalType,
      bank_name:
        patch.bank_name !== undefined ? trimNullable(patch.bank_name) : trimNullable(existing.bank_name),
      account_number:
        patch.account_number !== undefined
          ? trimNullable(patch.account_number)
          : trimNullable(existing.account_number),
      momo_provider:
        patch.momo_provider !== undefined
          ? trimNullable(patch.momo_provider)
          : trimNullable(existing.momo_provider),
      momo_number:
        patch.momo_number !== undefined ? trimNullable(patch.momo_number) : trimNullable(existing.momo_number),
    }

    const v = validateStaffPaymentMethodCreate(mergedForValidation)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

    const provider_name =
      patch.provider_name !== undefined
        ? trimNullable(patch.provider_name)
        : trimNullable(existing.provider_name)
    const bank_code =
      patch.bank_code !== undefined ? trimNullable(patch.bank_code) : trimNullable(existing.bank_code)
    const branch_name =
      patch.branch_name !== undefined ? trimNullable(patch.branch_name) : trimNullable(existing.branch_name)
    const account_name =
      patch.account_name !== undefined
        ? trimNullable(patch.account_name)
        : trimNullable(existing.account_name)

    let bank_name: string | null = null
    let account_number: string | null = null
    let momo_provider: string | null = null
    let momo_number: string | null = null

    if (finalType === "bank") {
      bank_name =
        patch.bank_name !== undefined ? trimNullable(patch.bank_name) : trimNullable(existing.bank_name)
      account_number =
        patch.account_number !== undefined
          ? trimNullable(patch.account_number)
          : trimNullable(existing.account_number)
    } else if (finalType === "momo") {
      momo_provider =
        patch.momo_provider !== undefined
          ? trimNullable(patch.momo_provider)
          : trimNullable(existing.momo_provider)
      momo_number =
        patch.momo_number !== undefined ? trimNullable(patch.momo_number) : trimNullable(existing.momo_number)
    }

    const updatePayload: Record<string, unknown> = {
      method_type: finalType,
      provider_name,
      bank_name,
      bank_code: finalType === "bank" ? bank_code : null,
      branch_name: finalType === "bank" ? branch_name : null,
      account_number,
      account_name,
      momo_provider,
      momo_number,
    }

    if (patch.is_default === true || patch.is_default === false) {
      updatePayload.is_default = Boolean(patch.is_default)
      if (patch.is_default === true) {
        await clearOtherDefaults(supabase, staffId, business.id, methodId)
      }
    }

    const { data: updated, error } = await supabase
      .from("staff_payment_methods")
      .update(updatePayload)
      .eq("id", methodId)
      .eq("staff_id", staffId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .select()
      .single()

    if (error) {
      console.error("[payment-methods PATCH]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ paymentMethod: updated })
  } catch (e: any) {
    console.error("[payment-methods PATCH]", e)
    return NextResponse.json({ error: e.message || "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; methodId: string }> | { id: string; methodId: string } }
) {
  try {
    const { id: staffId, methodId } = await Promise.resolve(params)

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

    const { error } = await supabase
      .from("staff_payment_methods")
      .update({ deleted_at: new Date().toISOString(), is_default: false })
      .eq("id", methodId)
      .eq("staff_id", staffId)
      .eq("business_id", business.id)
      .is("deleted_at", null)

    if (error) {
      console.error("[payment-methods DELETE]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("[payment-methods DELETE]", e)
    return NextResponse.json({ error: e.message || "Internal server error" }, { status: 500 })
  }
}
