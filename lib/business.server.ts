import "server-only"

import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import { ACTIVE_BUSINESS_COOKIE } from "./business/activeBusiness"
import { getAllUserBusinesses } from "./business"

/**
 * Server-side workspace resolution.
 *
 * Priority:
 *   1. The server-validated active-business cookie set by /api/business/select.
 *   2. A single accessible business for single-business users.
 *
 * There is deliberately NO "newest business" fallback. When a user has multiple
 * businesses and no valid active context, financial callers get null and must
 * stop rather than silently mutating another tenant.
 */
export async function resolveActiveBusinessServer(
  supabase: SupabaseClient,
  userId: string
) {
  let cookieBusinessId: string | null = null
  try {
    const store = await cookies()
    cookieBusinessId = store.get(ACTIVE_BUSINESS_COOKIE)?.value?.trim() || null
  } catch {
    // cookies() is unavailable outside a request scope; fall through safely.
  }

  if (cookieBusinessId) {
    const business = await loadAuthorizedBusiness(supabase, userId, cookieBusinessId)
    if (business) return business
  }

  // Preserve normal single-business behaviour without guessing between tenants.
  const accessible = await getAllUserBusinesses(supabase, userId)
  if (accessible.length === 1) return accessible[0]

  return null
}

/**
 * Registered once from instrumentation.ts so the universal lib/business.ts can
 * resolve the request-scoped cookie without importing next/headers into client
 * bundles.
 */
export function registerServerActiveBusinessResolver(): void {
  ;(globalThis as Record<string, unknown>).__finzaResolveActiveBusiness =
    resolveActiveBusinessServer
}

async function loadAuthorizedBusiness(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<(Record<string, unknown> & { id: string }) | null> {
  const { data: business, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (error || !business) return null

  if ((business as { owner_id?: string }).owner_id === userId) {
    return business as Record<string, unknown> & { id: string }
  }

  const { data: membership, error: membershipError } = await supabase
    .from("business_users")
    .select("id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle()

  if (membershipError || !membership) return null
  return business as Record<string, unknown> & { id: string }
}
