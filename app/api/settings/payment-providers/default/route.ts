import { NextRequest, NextResponse } from "next/server"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { fetchDefaultPaymentProvider } from "@/lib/settings/paymentProviders/service"
import type { PaymentProviderEnvironment } from "@/lib/tenantPayments/types"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

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
    const provider = await fetchDefaultPaymentProvider(supabase, scope.businessId, environment)
    return NextResponse.json({ provider })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal error"
    console.error("[GET /api/settings/payment-providers/default]", e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
