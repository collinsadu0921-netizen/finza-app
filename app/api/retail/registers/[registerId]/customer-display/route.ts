import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { canEditBusinessWideSensitiveSettings } from "@/lib/retail/retailSensitiveSettingsEditors"
import {
  extractBearerCashierPosToken,
  verifyCashierPosToken,
} from "@/lib/cashierPosToken.server"
import {
  REGISTER_CUSTOMER_DISPLAY_SELECT,
  assertNoComPortInConfigPayload,
  buildConfirmLocalImportPatch,
  buildRegisterCustomerDisplayWritePatch,
  mapRegisterRowToCustomerDisplayConfig,
  toCashierCustomerDisplayView,
  type RegisterCustomerDisplayProfileId,
  type RegisterCustomerDisplayRow,
} from "@/lib/retail/hardware/registerCustomerDisplayConfig"
import type { CustomerDisplayAmountWriteMode } from "@/lib/retail/hardware/customerDisplayTerminalConfig"

type RouteContext = { params: Promise<{ registerId: string }> }

function isProfileId(value: unknown): value is RegisterCustomerDisplayProfileId {
  return value === "2400" || value === "4800" || value === "9600" || value === "19200"
}

function isAmountWriteMode(value: unknown): value is CustomerDisplayAmountWriteMode {
  return value === "ascii_only" || value === "clear_then_amount"
}

async function loadRegisterRow(registerId: string): Promise<RegisterCustomerDisplayRow | null> {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from("registers")
    .select(REGISTER_CUSTOMER_DISPLAY_SELECT)
    .eq("id", registerId)
    .maybeSingle()
  if (error || !data) return null
  return data as RegisterCustomerDisplayRow
}

/**
 * GET register customer-display config.
 * - Owner/admin (session): full config
 * - Cashier (session or POS token): safe verified connect view only
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { registerId } = await context.params
    if (!registerId) {
      return NextResponse.json({ error: "Missing register id" }, { status: 400 })
    }

    const posToken = extractBearerCashierPosToken(request)
    if (posToken) {
      const claims = verifyCashierPosToken(posToken)
      if (!claims) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
      const row = await loadRegisterRow(registerId)
      if (!row || row.business_id !== claims.businessId || row.store_id !== claims.storeId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      const config = mapRegisterRowToCustomerDisplayConfig(row)
      const view = toCashierCustomerDisplayView(config)
      return NextResponse.json({
        role: "cashier",
        can_edit: false,
        view,
        // Do not return full config / diagnostics to PIN cashiers.
      })
    }

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

    const role = await getUserRole(supabase, user.id, business.id)
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const row = await loadRegisterRow(registerId)
    if (!row || row.business_id !== business.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const config = mapRegisterRowToCustomerDisplayConfig(row)
    const canEdit = canEditBusinessWideSensitiveSettings(role)
    if (!canEdit) {
      return NextResponse.json({
        role,
        can_edit: false,
        view: toCashierCustomerDisplayView(config),
      })
    }

    return NextResponse.json({
      role,
      can_edit: true,
      config,
      view: toCashierCustomerDisplayView(config),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * PUT — owner/admin only. Creates/updates serial profile + verification.
 * Never stores COM ports. Communication changes clear verification unless markVerified in same request.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { registerId } = await context.params
    if (!registerId) {
      return NextResponse.json({ error: "Missing register id" }, { status: 400 })
    }

    if (extractBearerCashierPosToken(request)) {
      return NextResponse.json(
        { error: "Forbidden: cashiers cannot change customer display configuration." },
        { status: 403 }
      )
    }

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

    const role = await getUserRole(supabase, user.id, business.id)
    if (!canEditBusinessWideSensitiveSettings(role)) {
      return NextResponse.json(
        { error: "Forbidden: only owners and admins can update customer display configuration." },
        { status: 403 }
      )
    }

    const body = (await request.json()) as Record<string, unknown>
    const comErr = assertNoComPortInConfigPayload(body)
    if (comErr) {
      return NextResponse.json({ error: comErr }, { status: 400 })
    }

    const row = await loadRegisterRow(registerId)
    if (!row || row.business_id !== business.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    // Optional store scoping: if body.storeId provided, must match register.
    if (typeof body.storeId === "string" && row.store_id && body.storeId !== row.store_id) {
      return NextResponse.json({ error: "Register is not in that store." }, { status: 403 })
    }

    const current = mapRegisterRowToCustomerDisplayConfig(row)
    const nowIso = new Date().toISOString()

    let patchResult:
      | { ok: true; patch: Record<string, unknown>; clearsVerification?: boolean }
      | { ok: false; error: string }

    if (body.confirmLocalImport === true) {
      const local = body.local as Record<string, unknown> | undefined
      if (!local || !isProfileId(local.profileId) || !isAmountWriteMode(local.amountWriteMode)) {
        return NextResponse.json(
          { error: "confirmLocalImport requires local.profileId and local.amountWriteMode." },
          { status: 400 }
        )
      }
      patchResult = buildConfirmLocalImportPatch(
        current,
        {
          profileId: local.profileId,
          amountWriteMode: local.amountWriteMode,
          verifiedNote: typeof local.verifiedNote === "string" ? local.verifiedNote : null,
        },
        user.id,
        nowIso,
        true
      )
    } else {
      if (!isProfileId(body.profileId) || !isAmountWriteMode(body.amountWriteMode)) {
        return NextResponse.json(
          { error: "profileId and amountWriteMode are required." },
          { status: 400 }
        )
      }
      patchResult = buildRegisterCustomerDisplayWritePatch(
        current,
        {
          profileId: body.profileId,
          amountWriteMode: body.amountWriteMode,
          markVerified: body.markVerified === true,
          clearVerification: body.clearVerification === true,
          verifiedNote: typeof body.verifiedNote === "string" ? body.verifiedNote : null,
          enabled: body.enabled === false ? false : true,
        },
        user.id,
        nowIso
      )
    }

    if (!patchResult.ok) {
      return NextResponse.json({ error: patchResult.error }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()
    const { data: updated, error: updateError } = await admin
      .from("registers")
      .update(patchResult.patch)
      .eq("id", registerId)
      .eq("business_id", business.id)
      .select(REGISTER_CUSTOMER_DISPLAY_SELECT)
      .maybeSingle()

    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message || "Update failed" },
        { status: 500 }
      )
    }

    const config = mapRegisterRowToCustomerDisplayConfig(updated as RegisterCustomerDisplayRow)
    return NextResponse.json({
      role,
      can_edit: true,
      config,
      view: toCashierCustomerDisplayView(config),
      clears_verification: patchResult.clearsVerification === true,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
