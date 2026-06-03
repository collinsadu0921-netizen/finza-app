/**
 * Server-side guards for the service workspace.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { getCurrentBusiness } from "@/lib/business"
import { type ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import {
  resolveServiceEntitlement,
  entitlementIncludesTier,
} from "@/lib/serviceWorkspace/resolveServiceEntitlement"
import { loadBusinessSubscriptionRow } from "@/lib/serviceWorkspace/loadBusinessBillingRow"

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

export function isSubscriptionPaymentLocked(
  graceUntil: string | Date | null | undefined
): boolean {
  if (graceUntil == null || graceUntil === "") return false
  const end = typeof graceUntil === "string" ? new Date(graceUntil) : graceUntil
  if (Number.isNaN(end.getTime())) return false
  return Date.now() >= end.getTime()
}

export type EnforceServiceAccessOptions = {
  supabase: SupabaseClient
  userId: string | null | undefined
  businessId: string
  minTier: ServiceSubscriptionTier
  /** read: allow read-only locked tenants; write: also require canWriteFinancialRecords */
  mode?: "read" | "write"
}

export const TRIAL_EXPIRED_READ_ONLY_MESSAGE =
  "Your trial has ended. Upgrade to continue creating or editing financial records."

/**
 * Returns null when access is allowed; a NextResponse (401 or 403) otherwise.
 *
 * Read mode: membership + tier (read-only lock does not block).
 * Write mode: also blocks when financial writes are locked.
 */
export async function enforceServiceWorkspaceAccess(
  opts: EnforceServiceAccessOptions
): Promise<NextResponse | null> {
  const { supabase, userId, businessId, minTier, mode = "read" } = opts

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

  if (mode === "write" && !entitlement.canWriteFinancialRecords) {
    return NextResponse.json(
      {
        error: TRIAL_EXPIRED_READ_ONLY_MESSAGE,
        code: "TRIAL_EXPIRED_READ_ONLY",
        trialGraceExpired: entitlement.trialGraceExpired,
        trialGraceActive: entitlement.trialGraceActive,
        isReadOnlyLocked: entitlement.isReadOnlyLocked,
      },
      { status: 403 }
    )
  }

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

  return null
}

/** Write guard — blocks read-only locked / expired unpaid trial tenants. */
export async function enforceServiceWorkspaceWriteAccess(
  opts: Omit<EnforceServiceAccessOptions, "mode">
): Promise<NextResponse | null> {
  return enforceServiceWorkspaceAccess({ ...opts, mode: "write" })
}

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
    mode: "read",
  })
  if (denied) return denied
  return { businessId }
}

/** @deprecated Prefer resolveServiceEntitlement() + loadBusinessSubscriptionRow() */
export async function getBusinessSubscriptionState(
  supabase: SupabaseClient,
  businessId: string
) {
  const row = await loadBusinessSubscriptionRow(supabase, businessId)
  const { rawTier, isReadOnlyLocked: locked } = resolveServiceEntitlement(row)
  return {
    tier: rawTier,
    graceUntil: row.subscription_grace_until ?? null,
    locked,
  }
}
