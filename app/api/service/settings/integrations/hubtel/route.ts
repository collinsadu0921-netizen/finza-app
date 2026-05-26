import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { assertBusinessPaymentWriteAccess } from "@/lib/settings/assertBusinessPaymentWriteAccess"
import {
  getHubtelIntegrationSettings,
  hubtelIntegrationErrorMessage,
  saveHubtelIntegrationSettings,
} from "@/lib/payments/hubtel/hubtelIntegrationService"
import {
  TenantPaymentEncryptionKeyInvalidError,
  TenantPaymentEncryptionKeyMissingError,
} from "@/lib/tenantPayments/errors"

export const dynamic = "force-dynamic"

function parseEnvironment(raw: unknown): "test" | "live" {
  return raw === "test" ? "test" : "live"
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const environment = parseEnvironment(searchParams.get("environment"))
    const settings = await getHubtelIntegrationSettings(supabase, scope.businessId, environment)

    return NextResponse.json({
      ...settings,
      statuses: ["not_connected", "pending_verification", "connected", "failed", "disconnected"],
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load Hubtel integration" },
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

    const body = (await request.json()) as Record<string, unknown>
    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      typeof body.business_id === "string" ? body.business_id : null
    )
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const writeGate = await assertBusinessPaymentWriteAccess(supabase, user.id, scope.businessId)
    if (!writeGate.ok) {
      return NextResponse.json({ error: writeGate.error }, { status: writeGate.status })
    }

    const collectionAccountNumber =
      typeof body.collection_account_number === "string"
        ? body.collection_account_number
        : typeof body.merchant_number === "string"
          ? body.merchant_number
          : typeof body.merchantAccountNumber === "string"
            ? body.merchantAccountNumber
            : ""

    const settings = await saveHubtelIntegrationSettings(supabase, scope.businessId, {
      apiId:
        typeof body.api_id === "string"
          ? body.api_id
          : typeof body.apiId === "string"
            ? body.apiId
            : undefined,
      apiKey:
        typeof body.api_key === "string"
          ? body.api_key
          : typeof body.apiKey === "string"
            ? body.apiKey
            : undefined,
      collectionAccountNumber,
      businessDisplayName:
        typeof body.business_display_name === "string"
          ? body.business_display_name
          : typeof body.display_name === "string"
            ? body.display_name
            : null,
      environment: parseEnvironment(body.environment),
      invoiceCheckoutEnabled:
        body.invoice_checkout_enabled === true ||
        body.invoiceCheckoutEnabled === true ||
        body.is_enabled === true,
    })

    return NextResponse.json({
      business_id: scope.businessId,
      settings,
      message: "Hubtel integration saved.",
    })
  } catch (e: unknown) {
    const message = hubtelIntegrationErrorMessage(e)
    const status =
      e instanceof TenantPaymentEncryptionKeyMissingError ||
      e instanceof TenantPaymentEncryptionKeyInvalidError
        ? 503
        : message.includes("required")
          ? 400
          : 500
    return NextResponse.json({ error: message }, { status })
  }
}
