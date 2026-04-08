import "server-only"

import type { NextRequest } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { userHasBusinessAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import {
  FINZA_PAYSTACK_METADATA_PURPOSE_KEY,
  FINZA_PAYSTACK_SUBSCRIPTION_PURPOSE,
  parseDeclaredSubscriptionTier,
} from "@/lib/serviceWorkspace/applyPaystackSubscriptionWebhook"
import { TIER_PRICING, type BillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import { normalizeCountry } from "@/lib/payments/eligibility"
import type { SubscriptionInitiateBody, SubscriptionPaymentGatewayId } from "./types"
import { paystackInitiateSubscriptionCard, paystackInitiateSubscriptionMomo } from "./paystackProvider"
import { isMtnMomoSandboxSubscriptionConfigured, mtnMomoSandboxInitiateSubscription } from "./mtnMomoSandboxProvider"

const BILLING_CYCLES: BillingCycle[] = ["monthly", "quarterly", "annual"]

function parseBillingCycle(raw: unknown): BillingCycle | null {
  if (typeof raw !== "string") return null
  const n = raw.trim().toLowerCase()
  return BILLING_CYCLES.includes(n as BillingCycle) ? (n as BillingCycle) : null
}

function defaultGateway(): SubscriptionPaymentGatewayId {
  const g = process.env.FINZA_SUBSCRIPTION_PAYMENT_GATEWAY?.trim().toLowerCase()
  if (g === "mtn_momo_sandbox" && isMtnMomoSandboxSubscriptionConfigured()) return "mtn_momo_sandbox"
  if (g === "paystack") return "paystack"
  if (isMtnMomoSandboxSubscriptionConfigured() && !process.env.PAYSTACK_SECRET_KEY) return "mtn_momo_sandbox"
  return "paystack"
}

export async function initiateServiceSubscriptionPayment(
  request: NextRequest,
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  body: SubscriptionInitiateBody
): Promise<Response> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY

  const gateway: SubscriptionPaymentGatewayId =
    body.gateway === "mtn_momo_sandbox" || body.gateway === "paystack"
      ? body.gateway
      : defaultGateway()

  if (gateway === "paystack" && !secretKey) {
    return Response.json({ error: "Paystack is not configured" }, { status: 503 })
  }
  if (gateway === "mtn_momo_sandbox" && !isMtnMomoSandboxSubscriptionConfigured()) {
    return Response.json({ error: "MTN MoMo subscription gateway is not configured" }, { status: 503 })
  }

  const businessId = typeof body.business_id === "string" ? body.business_id.trim() : ""
  const tier = parseDeclaredSubscriptionTier(body.target_tier)
  const cycle = parseBillingCycle(body.billing_cycle)
  const channel = body.channel === "momo" || body.channel === "card" ? body.channel : null

  if (!businessId || !tier || !cycle || !channel) {
    return Response.json(
      { error: "business_id, target_tier, billing_cycle, and channel (momo|card) are required" },
      { status: 400 }
    )
  }

  if (gateway === "mtn_momo_sandbox" && channel === "card") {
    return Response.json(
      { error: "MTN MoMo sandbox supports mobile money only; use Paystack for card checkout." },
      { status: 400 }
    )
  }

  const hasAccess = await userHasBusinessAccess(supabase, user.id, businessId)
  if (!hasAccess) {
    return Response.json({ error: "Forbidden: no access to this business" }, { status: 403 })
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id, address_country")
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (!business) {
    return Response.json({ error: "Business not found" }, { status: 404 })
  }

  const countryCode = normalizeCountry((business as { address_country?: string }).address_country)
  if (countryCode !== "GH") {
    return Response.json(
      { error: "Subscription checkout is only available for Ghana businesses" },
      { status: 403 }
    )
  }

  const amountGhs = TIER_PRICING[cycle][tier]
  const amountPesewas = Math.round(amountGhs * 100)
  const reference = `FNZ-SUB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

  const metadata: Record<string, string> = {
    [FINZA_PAYSTACK_METADATA_PURPOSE_KEY]: FINZA_PAYSTACK_SUBSCRIPTION_PURPOSE,
    business_id: businessId,
    target_tier: tier,
    billing_cycle: cycle,
    user_id: user.id,
  }

  const email =
    user.email?.trim() || `sub.${user.id.replace(/-/g, "").slice(0, 12)}@finza-noreply.africa`

  const ctx = {
    userId: user.id,
    userEmail: user.email ?? null,
    businessId,
    tier,
    cycle,
    channel,
    phone: typeof body.phone === "string" ? body.phone : undefined,
    momoProviderKey: typeof body.momo_provider === "string" ? body.momo_provider.toLowerCase() : undefined,
    amountGhs,
    amountPesewas,
    reference,
    metadata,
    email,
  }

  if (gateway === "mtn_momo_sandbox") {
    const out = await mtnMomoSandboxInitiateSubscription(supabase, ctx)
    if (!out.success) {
      return Response.json({ error: out.error }, { status: out.httpStatus })
    }
    return Response.json({ ...out, gateway })
  }

  if (channel === "momo") {
    const out = await paystackInitiateSubscriptionMomo(secretKey!, ctx)
    if (!out.success) {
      return Response.json({ error: out.error }, { status: out.httpStatus })
    }
    return Response.json({ ...out, gateway })
  }

  const out = await paystackInitiateSubscriptionCard(secretKey!, request, ctx)
  if (!out.success) {
    return Response.json({ error: out.error }, { status: out.httpStatus })
  }
  return Response.json({ ...out, gateway })
}
