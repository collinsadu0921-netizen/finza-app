import {
  resolveServiceEntitlement,
  type RawBusinessSubscriptionRow,
  type ServiceEntitlement,
} from "@/lib/serviceWorkspace/resolveServiceEntitlement"

export const SERVICE_SUBSCRIPTION_BUSINESS_COLUMNS =
  "id, service_subscription_tier, service_subscription_status, subscription_grace_until, trial_started_at, trial_ends_at, current_period_ends_at, billing_cycle, subscription_started_at, billing_exempt, billing_exempt_reason"

export function subscriptionEntitlementFromBusinessRow(
  row: Record<string, unknown> | null | undefined
): ServiceEntitlement {
  const r: RawBusinessSubscriptionRow = {
    service_subscription_tier:
      (row?.service_subscription_tier as string) ?? null,
    service_subscription_status:
      (row?.service_subscription_status as string) ?? null,
    trial_started_at: (row?.trial_started_at as string) ?? null,
    trial_ends_at: (row?.trial_ends_at as string) ?? null,
    subscription_grace_until: (row?.subscription_grace_until as string) ?? null,
    current_period_ends_at: (row?.current_period_ends_at as string) ?? null,
    billing_cycle: (row?.billing_cycle as string) ?? null,
    subscription_started_at: (row?.subscription_started_at as string) ?? null,
    billing_exempt: (row?.billing_exempt as boolean) ?? null,
    billing_exempt_reason: (row?.billing_exempt_reason as string) ?? null,
  }
  return resolveServiceEntitlement(r)
}

export type SubscriptionEntitlementScopeMode = "context" | "url_query" | "fallback"

/**
 * Chooses how ServiceSubscriptionProvider resolves entitlement for the current scope.
 */
export function resolveSubscriptionEntitlementScopeMode(
  ctxBusinessId: string | null | undefined,
  urlBusinessId: string | null
): SubscriptionEntitlementScopeMode {
  if (urlBusinessId) {
    if (ctxBusinessId && ctxBusinessId === urlBusinessId) {
      return "context"
    }
    return "url_query"
  }
  if (ctxBusinessId) {
    return "context"
  }
  return "fallback"
}

/** Stable key for subscription-relevant fields on a workspace business row. */
export function workspaceBusinessSubscriptionKey(
  row: Record<string, unknown> | null | undefined
): string | null {
  if (!row?.id || typeof row.id !== "string") return null
  return [
    row.id,
    row.service_subscription_tier ?? "",
    row.service_subscription_status ?? "",
    row.trial_ends_at ?? "",
    row.subscription_grace_until ?? "",
    row.billing_exempt ?? "",
    row.current_period_ends_at ?? "",
  ].join("|")
}
