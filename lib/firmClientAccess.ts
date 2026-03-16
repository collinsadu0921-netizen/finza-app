/**
 * Firm Client Access Guard
 * Verifies that a user has access to a business via their accounting firm membership
 */

import { SupabaseClient } from "@supabase/supabase-js"

/**
 * Check if user has access to business via accounting firm
 * Returns access level ('read', 'write', 'approve') or null if no access
 */
export async function checkFirmClientAccess(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<"read" | "write" | "approve" | null> {
  // First check if user is business owner (they have full access)
  const { data: business } = await supabase
    .from("businesses")
    .select("owner_id")
    .eq("id", businessId)
    .maybeSingle()

  if (business && business.owner_id === userId) {
    return "write" // Owners have write access
  }

  // Get user's firm IDs
  const { data: firmUsers } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", userId)

  if (!firmUsers || firmUsers.length === 0) {
    return null
  }

  const firmIds = firmUsers.map((fu) => fu.firm_id)

  // Check if any of the user's firms have access to this business
  const { data: firmClientAccess } = await supabase
    .from("accounting_firm_clients")
    .select("access_level")
    .eq("business_id", businessId)
    .in("firm_id", firmIds)
    .maybeSingle()

  if (firmClientAccess) {
    return firmClientAccess.access_level as "read" | "write" | "approve"
  }

  return null
}
