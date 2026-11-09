import type { SupabaseClient } from "@supabase/supabase-js"
import { checkAccountingAuthority } from "@/lib/accounting/auth"

export type AccountingWriteRoleDenied = {
  status: 403
  error: string
  code: string
}

/**
 * Main-compatible accounting-write role gate.
 *
 * Uses the canonical accounting authority helper so owners, admins,
 * authorized accountants and firm accountants keep their existing access,
 * while read-only accountants, staff without authority and cross-tenant
 * users are denied. Subscription/tier checks remain with the route's
 * existing service-workspace guard.
 */
export async function requireAccountingWriteRole(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<AccountingWriteRoleDenied | null> {
  const authority = await checkAccountingAuthority(
    supabase,
    userId,
    businessId,
    "write"
  )

  if (authority.authorized) return null

  return {
    status: 403,
    error: "Forbidden",
    code: "INSUFFICIENT_AUTHORITY",
  }
}
