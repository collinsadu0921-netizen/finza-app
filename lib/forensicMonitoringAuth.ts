/**
 * Read-only access control for forensic accounting monitoring.
 * Allowed: Owner, Firm Admin, Accounting Admin (business_users role owner/admin/accountant, or accounting_firm_users).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export async function canAccessForensicMonitoring(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data: firmRow } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()

  if (firmRow?.firm_id) {
    return true
  }

  const { data: businesses } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .limit(1)

  if (businesses && businesses.length > 0) {
    return true
  }

  const { data: businessUsers } = await supabase
    .from("business_users")
    .select("business_id")
    .eq("user_id", userId)
    .in("role", ["admin", "accountant"])
    .limit(1)

  if (businessUsers && businessUsers.length > 0) {
    return true
  }

  return false
}
