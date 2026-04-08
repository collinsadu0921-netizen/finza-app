/**
 * Authenticated subscription payment status.
 * Paystack: polling mirror of /api/payments/paystack/verify (webhook still activates).
 * MTN sandbox: polls MTN Collection status and applies subscription when successful.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { userHasBusinessAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { verifyServiceSubscriptionPayment } from "@/lib/payments/subscriptionGateway/verifyServiceSubscription"
import type { SubscriptionPaymentGatewayId } from "@/lib/payments/subscriptionGateway/types"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const reference = request.nextUrl.searchParams.get("reference")
  const businessId = request.nextUrl.searchParams.get("business_id")
  const gatewayRaw = request.nextUrl.searchParams.get("gateway")

  if (!reference?.trim()) {
    return NextResponse.json({ error: "reference is required" }, { status: 400 })
  }
  if (!businessId?.trim()) {
    return NextResponse.json({ error: "business_id is required" }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const hasAccess = await userHasBusinessAccess(supabase, user.id, businessId.trim())
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const gateway =
    gatewayRaw === "paystack" || gatewayRaw === "mtn_momo_sandbox"
      ? (gatewayRaw as SubscriptionPaymentGatewayId)
      : undefined

  const out = await verifyServiceSubscriptionPayment({
    supabase,
    reference: reference.trim(),
    gateway,
    businessIdAccessCheck: businessId.trim(),
  })

  if (out.error && out.status === "error") {
    return NextResponse.json(out, { status: 400 })
  }

  return NextResponse.json(out)
}
