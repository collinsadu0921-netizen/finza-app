/**
 * Server-side guards for service workspace: business membership, subscription
 * payment lock (post grace), and minimum tier.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { getCurrentBusiness } from "@/lib/business"
import {
  type ServiceSubscriptionTier,
  parseServiceSubscriptionTier,
  tierIncludes,
} from "@/lib/serviceWorkspace/subscriptionTiers"

export async function userHasBusinessAccess(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<boolean> {
  const { data: biz } = await supabase
    .from("businesses")
    .select("id, owner_id")
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (!biz) return false
  if ((biz as { owner_id?: string }).owner_id === userId) return true

  const { data: bu } = await supabase
    .from("business_users")
    .select("id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle()

  return !!bu
}

export function isSubscriptionPaymentLocked(graceUntil: string | Date | null | undefined): boolean {
  if (graceUntil == null || graceUntil === "") return false
  const end = typeof graceUntil === "string" ? new Date(graceUntil) : graceUntil
  if (Number.isNaN(end.getTime())) return false
  return Date.now() >= end.getTime()
}

export async function getBusinessSubscriptionState(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ tier: ServiceSubscriptionTier; graceUntil: string | null }> {
  const { data, error } = await supabase
    .from("businesses")
    .select("service_subscription_tier, subscription_grace_until")
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (error || !data) {
    return {
      tier: parseServiceSubscriptionTier(undefined),
      graceUntil: null,
    }
  }

  const row = data as {
    service_subscription_tier?: string | null
    subscription_grace_until?: string | null
  }

  return {
    tier: parseServiceSubscriptionTier(row.service_subscription_tier),
    graceUntil: row.subscription_grace_until ?? null,
  }
}

export type EnforceServiceAccessOptions = {
  supabase: SupabaseClient
  userId: string | null | undefined
  businessId: string
  minTier: ServiceSubscriptionTier
}

/**
 * @returns null if access allowed, otherwise a NextResponse with 401/403.
 */
export async function enforceServiceWorkspaceAccess(
  opts: EnforceServiceAccessOptions
): Promise<NextResponse | null> {
  const { supabase, userId, businessId, minTier } = opts

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const hasAccess = await userHasBusinessAccess(supabase, userId, businessId)
  if (!hasAccess) {
    return NextResponse.json(
      { error: "Forbidden: no access to this business" },
      { status: 403 }
    )
  }

  const { tier, graceUntil } = await getBusinessSubscriptionState(supabase, businessId)

  if (isSubscriptionPaymentLocked(graceUntil)) {
    return NextResponse.json(
      {
        error: "Subscription payment overdue. Renew to restore access.",
        code: "SUBSCRIPTION_LOCKED",
      },
      { status: 403 }
    )
  }

  if (!tierIncludes(tier, minTier)) {
    return NextResponse.json(
      {
        error: `Forbidden: requires ${minTier} plan or higher`,
        code: "TIER_REQUIRED",
      },
      { status: 403 }
    )
  }

  return null
}

/**
 * Resolve which business a VAT returns API call applies to, then enforce
 * Professional tier + subscription (same rules as TierGate on VAT pages).
 */
export async function resolveProfessionalVatBusinessId(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  explicitBusinessId: string | null | undefined
): Promise<{ businessId: string } | NextResponse> {
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const trimmed = explicitBusinessId?.trim() || null
  let businessId: string

  if (trimmed) {
    const ok = await userHasBusinessAccess(supabase, userId, trimmed)
    if (!ok) {
      return NextResponse.json(
        { error: "Forbidden: no access to this business" },
        { status: 403 }
      )
    }
    businessId = trimmed
  } else {
    const b = await getCurrentBusiness(supabase, userId)
    if (!b?.id) {
      return NextResponse.json(
        {
          error:
            "business_id is required, or complete onboarding to set a workspace.",
        },
        { status: 400 }
      )
    }
    businessId = b.id
  }

  const denied = await enforceServiceWorkspaceAccess({
    supabase,
    userId,
    businessId,
    minTier: "professional",
  })
  if (denied) return denied
  return { businessId }
}
