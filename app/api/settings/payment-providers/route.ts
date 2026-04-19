import { NextRequest, NextResponse } from "next/server"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { statusForSettingsError } from "@/lib/settings/paymentProviders/httpErrors"
import {
  createPaymentProvider,
  fetchPaymentSettingsIntegratedView,
} from "@/lib/settings/paymentProviders/service"
import type { PaymentProviderEnvironment } from "@/lib/tenantPayments/types"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertBusinessPaymentWriteAccess } from "@/lib/settings/assertBusinessPaymentWriteAccess"

function parseEnvironment(raw: string | null | undefined): PaymentProviderEnvironment {
  if (raw === "test" || raw === "live") return raw
  return "live"
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const environment = parseEnvironment(searchParams.get("environment"))
    const view = await fetchPaymentSettingsIntegratedView(supabase, scope.businessId, environment)
    return NextResponse.json(view)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal error"
    console.error("[GET /api/settings/payment-providers]", e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await request.json()) as Record<string, unknown>
    const businessIdRaw = typeof body.business_id === "string" ? body.business_id : ""
    const scope = await resolveBusinessScopeForUser(supabase, user.id, businessIdRaw)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const writeGate = await assertBusinessPaymentWriteAccess(supabase, user.id, scope.businessId)
    if (!writeGate.ok) {
      return NextResponse.json({ error: writeGate.error }, { status: writeGate.status })
    }

    const provider_type = body.provider_type
    if (provider_type === "paystack_tenant") {
      return NextResponse.json({ error: "Provider type not supported on this API" }, { status: 400 })
    }
    if (
      provider_type !== "mtn_momo_direct" &&
      provider_type !== "hubtel" &&
      provider_type !== "manual_wallet"
    ) {
      return NextResponse.json({ error: "Invalid provider_type" }, { status: 400 })
    }

    const public_config =
      body.public_config && typeof body.public_config === "object" && !Array.isArray(body.public_config)
        ? (body.public_config as Record<string, unknown>)
        : {}
    const secretsRaw =
      body.secrets && typeof body.secrets === "object" && !Array.isArray(body.secrets)
        ? (body.secrets as Record<string, unknown>)
        : undefined
    const secrets = provider_type === "manual_wallet" ? undefined : secretsRaw

    const environment = parseEnvironment(typeof body.environment === "string" ? body.environment : undefined)

    const masked = await createPaymentProvider(supabase, scope.businessId, {
      business_id: scope.businessId,
      environment,
      provider_type,
      is_enabled: typeof body.is_enabled === "boolean" ? body.is_enabled : undefined,
      is_default: typeof body.is_default === "boolean" ? body.is_default : undefined,
      public_config,
      secrets,
    })

    return NextResponse.json({ provider: masked })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Bad request"
    const status = statusForSettingsError(message)
    if (status >= 500) console.error("[POST /api/settings/payment-providers]", e)
    return NextResponse.json({ error: message }, { status })
  }
}
