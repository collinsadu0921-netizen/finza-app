/**
 * Accounting authority guard for API routes.
 * Determines if a user has read or write accounting access to a business.
 * Sources: business owner, business_users (admin/accountant), or firm via canonical engine.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getUserRole } from "@/lib/userRoles"
import { isUserAccountantReadonly } from "@/lib/userRoles"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"

export type AccountingAuthorityAccess = "read" | "write"

export type AccountingAuthorityResult = {
  authorized: boolean
  businessId: string
  authority_source?: "owner" | "employee" | "accountant"
}

/**
 * Check if user has accounting authority for a business (read or write).
 * Authorized: owner, business_users with admin/accountant, or firm user via getAccountingAuthority.
 * Write: owner always; employee/accountant only if not accountant_readonly; firm only if engine allows write/approve.
 */
export async function checkAccountingAuthority(
  supabase: SupabaseClient,
  userId: string,
  businessId: string,
  accessLevel: AccountingAuthorityAccess
): Promise<AccountingAuthorityResult> {
  const result: AccountingAuthorityResult = { authorized: false, businessId }

  const role = await getUserRole(supabase, userId, businessId)
  if (role === "owner") {
    result.authorized = true
    result.authority_source = "owner"
    return result
  }
  if (role === "admin" || role === "accountant") {
    if (accessLevel === "write") {
      const readonly = await isUserAccountantReadonly(supabase, userId, businessId)
      if (readonly) return result
    }
    result.authorized = true
    result.authority_source = role === "accountant" ? "accountant" : "employee"
    return result
  }

  const auth = await getAccountingAuthority({
    supabase,
    firmUserId: userId,
    businessId,
    requiredLevel: accessLevel,
  })
  if (auth.allowed) {
    result.authorized = true
    result.authority_source = "accountant"
  }
  return result
}
