import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { TIER_PRICING, type BillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import { tryParseServiceSubscriptionTier, type ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import {
  createSubscriptionCheckoutSession,
} from "@/lib/payments/subscription/subscriptionCheckoutService"
import { isMockSubscriptionFlowEnabled } from "@/lib/payments/subscription/mockFeatureFlag"

const BILLING_CYCLES: BillingCycle[] = ["monthly", "quarterly", "annual"]

function parseBillingCycle(raw: unknown): BillingCycle | null {
  if (typeof raw !== "string") return null
  const v = raw.trim().toLowerCase()
  return BILLING_CYCLES.includes(v as BillingCycle) ? (v as BillingCycle) : null
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

    const tier = tryParseServiceSubscriptionTier(typeof body.target_tier === "string" ? body.target_tier : null)
    const cycle = parseBillingCycle(body.billing_cycle)
    if (!tier || !cycle) {
      return NextResponse.json(
        { error: "target_tier and billing_cycle are required" },
        { status: 400 }
      )
    }

    if (!isMockSubscriptionFlowEnabled()) {
      return NextResponse.json({ error: "Provider-neutral mock checkout is disabled" }, { status: 404 })
    }

    if (body.provider != null && body.provider !== "mock") {
      return NextResponse.json({ error: "Unsupported provider" }, { status: 400 })
    }

    const amount = TIER_PRICING[cycle][tier as ServiceSubscriptionTier]

    const result = await createSubscriptionCheckoutSession(supabase, {
      businessId: scope.businessId,
      planTier: tier,
      billingCycle: cycle,
      amount,
      currency: "GHS",
      provider: "mock",
      metadata: {
        source: "service_subscription_settings",
        created_by_user_id: user.id,
      },
    })

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Checkout failed" },
      { status: 500 }
    )
  }
}

