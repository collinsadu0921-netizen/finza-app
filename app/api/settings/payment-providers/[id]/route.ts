import { NextRequest, NextResponse } from "next/server"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { statusForSettingsError } from "@/lib/settings/paymentProviders/httpErrors"
import { updatePaymentProvider } from "@/lib/settings/paymentProviders/service"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertBusinessPaymentWriteAccess } from "@/lib/settings/assertBusinessPaymentWriteAccess"

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, ctx: RouteParams) {
  try {
    const { id: providerId } = await ctx.params
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

    const public_config =
      body.public_config !== undefined &&
      typeof body.public_config === "object" &&
      body.public_config !== null &&
      !Array.isArray(body.public_config)
        ? (body.public_config as Record<string, unknown>)
        : undefined

    const secrets =
      body.secrets !== undefined &&
      typeof body.secrets === "object" &&
      body.secrets !== null &&
      !Array.isArray(body.secrets)
        ? (body.secrets as Record<string, unknown>)
        : undefined

    let validation_status: "unvalidated" | "valid" | "invalid" | undefined
    if (body.validation_status === "unvalidated" || body.validation_status === "valid" || body.validation_status === "invalid") {
      validation_status = body.validation_status
    }

    const masked = await updatePaymentProvider(supabase, scope.businessId, providerId, {
      business_id: scope.businessId,
      public_config,
      secrets,
      is_enabled: typeof body.is_enabled === "boolean" ? body.is_enabled : undefined,
      validation_status,
    })

    return NextResponse.json({ provider: masked })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Bad request"
    const status = statusForSettingsError(message)
    if (status >= 500) console.error("[PATCH /api/settings/payment-providers/[id]]", e)
    return NextResponse.json({ error: message }, { status })
  }
}
