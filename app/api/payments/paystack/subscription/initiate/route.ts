/**
 * Start a Paystack payment for service workspace subscription (no invoice).
 * MoMo: POST /charge. Card: POST /transaction/initialize → authorization_url.
 *
 * Webhook: /api/payments/webhooks/mobile-money (Paystack) updates tier + grace
 * when metadata.finza_purpose = service_subscription.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { userHasBusinessAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import {
  FINZA_PAYSTACK_METADATA_PURPOSE_KEY,
  FINZA_PAYSTACK_SUBSCRIPTION_PURPOSE,
  parseDeclaredSubscriptionTier,
} from "@/lib/serviceWorkspace/applyPaystackSubscriptionWebhook"
import { TIER_PRICING, type BillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import { normalizeCountry } from "@/lib/payments/eligibility"

export const dynamic = "force-dynamic"

const BILLING_CYCLES: BillingCycle[] = ["monthly", "quarterly", "annual"]

function parseBillingCycle(raw: unknown): BillingCycle | null {
  if (typeof raw !== "string") return null
  const n = raw.trim().toLowerCase()
  return BILLING_CYCLES.includes(n as BillingCycle) ? (n as BillingCycle) : null
}

const MOMO_PROVIDER_CODES: Record<string, string> = {
  mtn: "mtn",
  vodafone: "vod",
  airteltigo: "atl",
}

export async function POST(request: NextRequest) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json({ error: "Paystack is not configured" }, { status: 503 })
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: {
    business_id?: string
    target_tier?: string
    billing_cycle?: string
    channel?: string
    phone?: string
    momo_provider?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const businessId = typeof body.business_id === "string" ? body.business_id.trim() : ""
  const tier = parseDeclaredSubscriptionTier(body.target_tier)
  const cycle = parseBillingCycle(body.billing_cycle)
  const channel = body.channel === "momo" || body.channel === "card" ? body.channel : null

  if (!businessId || !tier || !cycle || !channel) {
    return NextResponse.json(
      { error: "business_id, target_tier, billing_cycle, and channel (momo|card) are required" },
      { status: 400 }
    )
  }

  const hasAccess = await userHasBusinessAccess(supabase, user.id, businessId)
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden: no access to this business" }, { status: 403 })
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id, address_country")
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 })
  }

  const countryCode = normalizeCountry((business as { address_country?: string }).address_country)
  if (countryCode !== "GH") {
    return NextResponse.json(
      { error: "Subscription checkout via Paystack is only available for Ghana businesses" },
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

  if (channel === "momo") {
    const phone = typeof body.phone === "string" ? body.phone.replace(/\s+/g, "") : ""
    const momoKey = typeof body.momo_provider === "string" ? body.momo_provider.toLowerCase() : ""
    if (!phone || !momoKey) {
      return NextResponse.json(
        { error: "phone and momo_provider (mtn|vodafone|airteltigo) are required for MoMo" },
        { status: 400 }
      )
    }

    const paystackRes = await fetch("https://api.paystack.co/charge", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPesewas,
        email,
        currency: "GHS",
        reference,
        mobile_money: {
          phone: phone.replace(/^0/, "+233"),
          provider: MOMO_PROVIDER_CODES[momoKey] ?? "mtn",
        },
        metadata,
      }),
    })

    const psData = await paystackRes.json()
    if (!paystackRes.ok || !psData.status) {
      return NextResponse.json(
        { error: psData.message || "Paystack charge failed" },
        { status: 502 }
      )
    }

    const chargeStatus: string = psData.data?.status ?? "pending"
    const failed = chargeStatus === "failed" || chargeStatus === "error"
    if (failed) {
      return NextResponse.json(
        { error: psData.data?.gateway_response || "Charge was declined" },
        { status: 402 }
      )
    }

    return NextResponse.json({
      success: true,
      channel: "momo",
      reference,
      status: chargeStatus,
      otp_required: chargeStatus === "send_otp",
      display_text: psData.data?.display_text ?? null,
    })
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")
  const callback_url = `${appUrl}/service/settings/subscription?sub_callback=1`

  const initRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: amountPesewas,
      currency: "GHS",
      reference,
      callback_url,
      metadata,
      channels: ["card"],
    }),
  })

  const initData = await initRes.json()
  if (!initRes.ok || !initData.status) {
    return NextResponse.json(
      { error: initData.message || "Paystack initialize failed" },
      { status: 502 }
    )
  }

  const authUrl = initData.data?.authorization_url as string | undefined
  if (!authUrl) {
    return NextResponse.json({ error: "No authorization URL returned" }, { status: 502 })
  }

  return NextResponse.json({
    success: true,
    channel: "card",
    reference,
    authorization_url: authUrl,
    access_code: initData.data?.access_code ?? null,
  })
}
