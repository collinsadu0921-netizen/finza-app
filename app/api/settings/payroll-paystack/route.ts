import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission, requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import {
  PAYSTACK_PAYROLL_TABLE,
  encryptPaystackSecretKey,
  expectedPaystackEnvironmentForRuntime,
  isPaystackLiveTransfersEnabled,
  loadPaystackPayrollConnection,
  paystackPayrollWebhookUrl,
  publicPaystackConnectionView,
  validatePaystackSecretForEnvironment,
  type PaystackPayrollConnectionRow,
} from "@/lib/payroll/paystack/connection"
import {
  fetchPaystackGhsBalancePesewas,
  isPaystackPayrollMockMode,
  maskPaystackSecretKey,
  paystackKeyEnvironment,
  type PaystackEnvironment,
} from "@/lib/payroll/paystack/paystackClient"

const CLEARING_CODE = "1040"
const FEE_CODE = "5310"

async function ensurePayrollPaystackAccounts(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: string
): Promise<{ clearingAccountId: string; feeAccountId: string }> {
  const { error: upsertError } = await admin.from("accounts").upsert(
    [
      {
        business_id: businessId,
        name: "Paystack Payroll Clearing",
        code: CLEARING_CODE,
        type: "asset",
        description: "Funds held in the business Paystack balance for payroll salary transfers",
        is_system: true,
      },
      {
        business_id: businessId,
        name: "Payment Processing Fees",
        code: FEE_CODE,
        type: "expense",
        description: "Paystack and payment-provider transfer fees",
        is_system: true,
      },
    ],
    { onConflict: "business_id,code", ignoreDuplicates: true }
  )

  if (upsertError) throw new Error(upsertError.message)

  const { data: accounts, error } = await admin
    .from("accounts")
    .select("id, code")
    .eq("business_id", businessId)
    .in("code", [CLEARING_CODE, FEE_CODE])
    .is("deleted_at", null)

  if (error) throw new Error(error.message)

  const clearing = (accounts || []).find((a) => a.code === CLEARING_CODE)?.id
  const fee = (accounts || []).find((a) => a.code === FEE_CODE)?.id
  if (!clearing || !fee) throw new Error("Could not create Paystack payroll accounts")
  return { clearingAccountId: String(clearing), feeAccountId: String(fee) }
}

function requestOrigin(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "")
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host
  return `${proto}://${host}`
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

    const tierDenied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId: business.id,
      minTier: "business",
      mode: "read",
    })
    if (tierDenied) return tierDenied

    const canView = await hasPermission(supabase, user.id, business.id, PERMISSIONS.SETTINGS_VIEW)
    const canEdit = await hasPermission(supabase, user.id, business.id, PERMISSIONS.SETTINGS_EDIT)
    if (!canView && !canEdit) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const admin = createSupabaseAdminClient()
    const connection = await loadPaystackPayrollConnection(admin, business.id)
    const view = publicPaystackConnectionView(connection?.row ?? null, connection?.secretKey ?? null)

    let balancePesewas = view.balance_pesewas
    let balanceError: string | null = null
    if (connection?.row && connection.secretKey && connection.row.is_active) {
      const balance = await fetchPaystackGhsBalancePesewas(connection.secretKey)
      if (balance.ok) {
        balancePesewas = balance.data.balance_pesewas
        if (balancePesewas != null) {
          await admin
            .from(PAYSTACK_PAYROLL_TABLE)
            .update({
              last_balance_pesewas: balancePesewas,
              last_balance_checked_at: new Date().toISOString(),
              last_error: null,
            })
            .eq("business_id", business.id)
        }
      } else {
        balanceError = balance.error
        await admin
          .from(PAYSTACK_PAYROLL_TABLE)
          .update({
            last_error: balance.error,
            validation_status: balance.code === "PAYSTACK_UNAUTHORIZED" ? "invalid" : "unvalidated",
          })
          .eq("business_id", business.id)
      }
    }

    return NextResponse.json({
      connection: {
        ...view,
        balance_pesewas: balancePesewas,
        balance_error: balanceError,
        masked_key: view.masked_key,
      },
      webhook_url: paystackPayrollWebhookUrl(requestOrigin(request)),
      webhook_events: ["transfer.success", "transfer.failed", "transfer.reversed"],
      live_transfers_enabled: isPaystackLiveTransfersEnabled(),
      mock_mode: isPaystackPayrollMockMode(),
      expected_environment: expectedPaystackEnvironmentForRuntime(),
      can_edit: canEdit,
      accounts: {
        clearing: view.clearing_account_id,
        fee: view.fee_account_id,
      },
    })
  } catch (error: unknown) {
    console.error("[payroll-paystack settings GET]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
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

    const tierDenied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId: business.id,
      minTier: "business",
      mode: "write",
    })
    if (tierDenied) return tierDenied

    const { allowed } = await requirePermission(
      supabase,
      user.id,
      business.id,
      PERMISSIONS.SETTINGS_EDIT
    )
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

    const secretKey = String(body.secret_key ?? "").trim()
    const requestedEnvironment = String(body.environment ?? "").trim().toLowerCase()
    if (!secretKey) return NextResponse.json({ error: "Paystack secret key is required" }, { status: 400 })
    if (requestedEnvironment !== "test" && requestedEnvironment !== "live") {
      return NextResponse.json({ error: "environment must be test or live" }, { status: 400 })
    }

    const environment = requestedEnvironment as PaystackEnvironment
    const validation = validatePaystackSecretForEnvironment(secretKey, environment)
    if (!validation.ok) return NextResponse.json({ error: validation.message }, { status: 400 })

    const keyEnvironment = paystackKeyEnvironment(secretKey)
    if (keyEnvironment !== environment) {
      return NextResponse.json({ error: "Paystack key environment mismatch" }, { status: 400 })
    }

    const balance = await fetchPaystackGhsBalancePesewas(secretKey)
    if (!balance.ok) {
      return NextResponse.json(
        {
          error:
            balance.code === "PAYSTACK_UNAUTHORIZED"
              ? "Paystack rejected this secret key. Check that you copied the correct test/live key."
              : "Could not validate this Paystack account. Check the key and try again.",
          code: balance.code,
        },
        { status: balance.code === "PAYSTACK_UNAUTHORIZED" ? 400 : 502 }
      )
    }

    const admin = createSupabaseAdminClient()
    const accounts = await ensurePayrollPaystackAccounts(admin, business.id)

    let encrypted: string
    try {
      encrypted = encryptPaystackSecretKey(secretKey)
    } catch {
      return NextResponse.json(
        {
          error:
            "Paystack payroll credential encryption is not configured on this deployment. Contact Finza support.",
          code: "PAYSTACK_ENCRYPTION_NOT_CONFIGURED",
        },
        { status: 503 }
      )
    }

    const { data: saved, error } = await admin
      .from(PAYSTACK_PAYROLL_TABLE)
      .upsert(
        {
          business_id: business.id,
          environment,
          secret_key_encrypted: encrypted,
          status: "connected",
          validation_status: "validated",
          validated_at: new Date().toISOString(),
          last_balance_pesewas: balance.data.balance_pesewas,
          last_balance_checked_at: new Date().toISOString(),
          last_error: null,
          clearing_account_id: accounts.clearingAccountId,
          fee_account_id: accounts.feeAccountId,
          is_active: true,
          created_by: user.id,
        },
        { onConflict: "business_id" }
      )
      .select("*")
      .single()

    if (error || !saved) {
      console.error("[payroll-paystack settings POST]", error)
      return NextResponse.json({ error: error?.message || "Failed to save connection" }, { status: 500 })
    }

    await supabase.rpc("create_audit_log", {
      p_business_id: business.id,
      p_user_id: user.id,
      p_action_type: "payroll.paystack_connected",
      p_entity_type: "business_paystack_payroll_account",
      p_entity_id: saved.id,
      p_new_values: {
        environment,
        masked_key: maskPaystackSecretKey(secretKey),
        status: "connected",
      },
      p_description: "Business Paystack account connected for payroll salary transfers",
    })

    return NextResponse.json({
      connection: publicPaystackConnectionView(saved as PaystackPayrollConnectionRow, secretKey),
      webhook_url: paystackPayrollWebhookUrl(requestOrigin(request)),
      live_transfers_enabled: isPaystackLiveTransfersEnabled(),
    })
  } catch (error: unknown) {
    console.error("[payroll-paystack settings POST]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierDenied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId: business.id,
      minTier: "business",
      mode: "write",
    })
    if (tierDenied) return tierDenied

    const { allowed } = await requirePermission(
      supabase,
      user.id,
      business.id,
      PERMISSIONS.SETTINGS_EDIT
    )
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const admin = createSupabaseAdminClient()
    const { error } = await admin
      .from(PAYSTACK_PAYROLL_TABLE)
      .update({
        is_active: false,
        status: "disconnected",
        validation_status: "unvalidated",
        secret_key_encrypted: null,
        last_balance_pesewas: null,
        last_balance_checked_at: null,
        last_error: null,
      })
      .eq("business_id", business.id)

    if (error) {
      console.error("[payroll-paystack settings DELETE]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await supabase.rpc("create_audit_log", {
      p_business_id: business.id,
      p_user_id: user.id,
      p_action_type: "payroll.paystack_disconnected",
      p_entity_type: "business_paystack_payroll_account",
      p_description: "Business Paystack payroll connection disconnected",
    })

    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    console.error("[payroll-paystack settings DELETE]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
