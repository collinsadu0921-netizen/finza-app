/**
 * Server-side guards for the service workspace.
 *
 * Uses resolveServiceEntitlement (the same logic as the client context) so
 * that server and client always make identical access decisions.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { getCurrentBusiness } from "@/lib/business"
import { type ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import {
  resolveServiceEntitlement,
  entitlementIncludesTier,
  type RawBusinessSubscriptionRow,
} from "@/lib/serviceWorkspace/resolveServiceEntitlement"

// ---------------------------------------------------------------------------
// Membership check
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Subscription state loader
// ---------------------------------------------------------------------------

async function loadBusinessSubscriptionRow(
  supabase: SupabaseClient,
  businessId: string
): Promise<RawBusinessSubscriptionRow> {
  const { data } = await supabase
    .from("businesses")
    .select(
      "service_subscription_tier, service_subscription_status, subscription_grace_until, trial_started_at, trial_ends_at"
    )
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (!data) return {}

  return data as RawBusinessSubscriptionRow
}

// ---------------------------------------------------------------------------
// Legacy helper kept for callers that need raw grace-only state
// ---------------------------------------------------------------------------

export function isSubscriptionPaymentLocked(
  graceUntil: string | Date | null | undefined
): boolean {
  if (graceUntil == null || graceUntil === "") return false
  const end = typeof graceUntil === "string" ? new Date(graceUntil) : graceUntil
  if (Number.isNaN(end.getTime())) return false
  return Date.now() >= end.getTime()
}

// ---------------------------------------------------------------------------
// Main enforcement function
// ---------------------------------------------------------------------------

export type EnforceServiceAccessOptions = {
  supabase: SupabaseClient
  userId: string | null | undefined
  businessId: string
  minTier: ServiceSubscriptionTier
}

/**
 * Returns null when access is allowed; a NextResponse (401 or 403) otherwise.
 *
 * Check order:
 * 1. Auth            — userId must be present
 * 2. Membership      — user must own or be a member of the business
 * 3. Payment lock    — subscription_grace_until expired → 403 SUBSCRIPTION_LOCKED
 * 4. Effective tier  — resolveServiceEntitlement() determines effectiveTier
 *                      (handles active trial, trial expiry downgrade, paid sub)
 *                      → 403 TIER_REQUIRED if effectiveTier < minTier
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

  const row = await loadBusinessSubscriptionRow(supabase, businessId)
  const entitlement = resolveServiceEntitlement(row)

  // MoMo renewal grace expired — hard block regardless of tier
  if (entitlement.isSubscriptionLocked) {
    return NextResponse.json(
      {
        error: "Subscription payment overdue. Renew to restore access.",
        code: "SUBSCRIPTION_LOCKED",
      },
      { status: 403 }
    )
  }

  // Effective tier check (handles active trial and trial-expiry downgrade)
  if (!entitlementIncludesTier(entitlement, minTier)) {
    return NextResponse.json(
      {
        error: `Forbidden: requires ${minTier} plan or higher`,
        code: "TIER_REQUIRED",
        effectiveTier: entitlement.effectiveTier,
      },
      { status: 403 }
    )
  }

  return null // access granted
}

// ---------------------------------------------------------------------------
// VAT-specific helper (Professional tier + subscription check)
// ---------------------------------------------------------------------------

/**
 * Resolve which business a VAT returns API call applies to, then enforce
 * Professional tier + subscription (mirrors TierGate on VAT pages).
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
        { error: "business_id is required, or complete onboarding to set a workspace." },
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

// ---------------------------------------------------------------------------
// Kept for callers that only need subscription state without tier enforcement
// ---------------------------------------------------------------------------

/** @deprecated Prefer resolveServiceEntitlement() + loadBusinessSubscriptionRow() */
export async function getBusinessSubscriptionState(
  supabase: SupabaseClient,
  businessId: string
) {
  const row = await loadBusinessSubscriptionRow(supabase, businessId)
  const { rawTier, isSubscriptionLocked: locked } = resolveServiceEntitlement(row)
  return {
    tier: rawTier,
    graceUntil: row.subscription_grace_until ?? null,
  }
}
