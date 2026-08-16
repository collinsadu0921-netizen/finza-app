/**
 * Server-side tenant scope resolution for API routes.
 * Instrumentation labels match actual operations in this module.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { timedStepMs } from "../server/routeDiagnostics"

export type BusinessScopeDiagnostics = {
  recordTiming(name: string, durMs: number, desc?: string): void
  step?(name: string, fields?: Record<string, unknown>): void
}

export type ResolveBusinessScopeOptions = {
  /**
   * Role already resolved server-side in the same request (e.g. prior getUserRole).
   * Skips membership lookup when defined; ownership is still verified independently.
   */
  knownRole?: string | null
  diag?: BusinessScopeDiagnostics
}

export type ResolveBusinessScopeResult =
  | { ok: true; businessId: string }
  | { ok: false; status: number; error: string }

type ExplicitBusinessRow = {
  id: string
  owner_id: string | null
}

async function resolveExplicitBusinessScope(
  supabase: SupabaseClient,
  userId: string,
  explicitBusinessId: string,
  options?: ResolveBusinessScopeOptions
): Promise<ResolveBusinessScopeResult> {
  const diag = options?.diag
  const scopeT0 = performance.now()

  const tBusiness = performance.now()
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, owner_id")
    .eq("id", explicitBusinessId)
    .is("archived_at", null)
    .maybeSingle()

  diag?.recordTiming("business_lookup", timedStepMs(tBusiness), "businesses")
  diag?.step?.("business_lookup", {
    ms: timedStepMs(tBusiness),
    table: "businesses",
    columns: "id,owner_id",
  })

  if (businessError || !business) {
    diag?.recordTiming("scope_total", timedStepMs(scopeT0), "explicit")
    return { ok: false, status: 404, error: "Business not found" }
  }

  const row = business as ExplicitBusinessRow

  if (row.owner_id === userId) {
    diag?.recordTiming("owner_check", 0, "matched")
    diag?.recordTiming("scope_total", timedStepMs(scopeT0), "explicit_owner")
    return { ok: true, businessId: row.id }
  }

  diag?.recordTiming("owner_check", 0, "not_owner")

  let role = options?.knownRole
  if (role === undefined) {
    const tMembership = performance.now()
    const { data: member, error: memberError } = await supabase
      .from("business_users")
      .select("role")
      .eq("business_id", explicitBusinessId)
      .eq("user_id", userId)
      .maybeSingle()

    diag?.recordTiming("membership_lookup", timedStepMs(tMembership), "business_users")
    diag?.step?.("membership_lookup", {
      ms: timedStepMs(tMembership),
      table: "business_users",
      columns: "role",
    })

    if (memberError) {
      diag?.recordTiming("scope_total", timedStepMs(scopeT0), "explicit_member_error")
      return { ok: false, status: 403, error: "Forbidden" }
    }

    role = member?.role ?? null
  }

  if (!role) {
    diag?.recordTiming("scope_total", timedStepMs(scopeT0), "explicit_forbidden")
    return { ok: false, status: 403, error: "Forbidden" }
  }

  diag?.recordTiming("scope_total", timedStepMs(scopeT0), "explicit_member")
  return { ok: true, businessId: row.id }
}

export async function resolveBusinessScopeForUser(
  supabase: SupabaseClient,
  userId: string,
  requestedBusinessId: string | null | undefined,
  options?: ResolveBusinessScopeOptions
): Promise<ResolveBusinessScopeResult> {
  const trimmed =
    typeof requestedBusinessId === "string" ? requestedBusinessId.trim() : ""
  const explicit = trimmed.length > 0 ? trimmed : null

  if (explicit) {
    return resolveExplicitBusinessScope(supabase, userId, explicit, options)
  }

  const scopeT0 = performance.now()
  const diag = options?.diag

  const tFallback = performance.now()
  const { getCurrentBusiness } = await import("../business")
  const business = await getCurrentBusiness(supabase, userId)
  diag?.recordTiming("business_fallback", timedStepMs(tFallback), "getCurrentBusiness")
  diag?.recordTiming("scope_total", timedStepMs(scopeT0), "implicit")

  if (!business) {
    return { ok: false, status: 404, error: "Business not found" }
  }
  return { ok: true, businessId: business.id }
}

export async function requireBusinessScopeForUser(
  supabase: SupabaseClient,
  userId: string,
  requestedBusinessId: string | null | undefined,
  options?: ResolveBusinessScopeOptions
): Promise<ResolveBusinessScopeResult> {
  const trimmed =
    typeof requestedBusinessId === "string" ? requestedBusinessId.trim() : ""
  if (!trimmed) {
    return { ok: false, status: 400, error: "Missing business_id" }
  }
  return resolveExplicitBusinessScope(supabase, userId, trimmed, options)
}
