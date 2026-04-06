import { NextRequest, NextResponse } from "next/server"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { statusForSettingsError } from "@/lib/settings/paymentProviders/httpErrors"
import { setPaymentProviderEnabled } from "@/lib/settings/paymentProviders/service"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteParams) {
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

    const masked = await setPaymentProviderEnabled(supabase, scope.businessId, providerId, false)
    return NextResponse.json({ provider: masked })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Bad request"
    const status = statusForSettingsError(message)
    if (status >= 500) console.error("[POST .../disable]", e)
    return NextResponse.json({ error: message }, { status })
  }
}
