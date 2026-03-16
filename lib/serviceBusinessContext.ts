/**
 * Service workspace business context resolution.
 * Canonical resolver: getCurrentBusiness(supabase, userId).
 * Returns businessId only when the user has a business and it is claimed (owner_id IS NOT NULL).
 * Firm-created unclaimed businesses never appear in service mode.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getCurrentBusiness } from "@/lib/business"

export type ServiceBusinessContext =
  | { businessId: string }
  | { error: "NO_CONTEXT" }

/**
 * Resolves the single business context for service workspace (owner or employee).
 * Thin wrapper around getCurrentBusiness for deterministic ordering (created_at DESC).
 * Guard: business must have owner_id IS NOT NULL (no firm-created unclaimed businesses).
 */
export async function resolveServiceBusinessContext(
  supabase: SupabaseClient,
  userId: string
): Promise<ServiceBusinessContext> {
  const business = await getCurrentBusiness(supabase, userId)
  if (!business?.id) {
    return { error: "NO_CONTEXT" }
  }
  if (business.owner_id == null) {
    return { error: "NO_CONTEXT" }
  }
  return { businessId: business.id }
}
