import { SupabaseClient } from "@supabase/supabase-js"

/** Role string from business_users or "owner"; null when not found */
export type UserRole = string | null

export async function getUserRole(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<string | null> {
  // First check if user is the business owner
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("owner_id")
    .eq("id", businessId)
    .maybeSingle()

  if (!businessError && business && business.owner_id === userId) {
    return "owner"
  }

  // Then check business_users table
  const { data, error } = await supabase
    .from("business_users")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    console.error("Error getting user role:", error)
    return null
  }

  if (!data) {
    return null
  }

  return data.role
}

export async function hasAccessToSalesHistory(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<boolean> {
  const role = await getUserRole(supabase, userId, businessId)
  // Allow owner, admin, manager, and employee to access sales history and related features
  return role === "owner" || role === "admin" || role === "manager" || role === "employee"
}

/**
 * @deprecated Use hasAccessToSalesHistory() instead
 * Kept for backward compatibility during migration
 */
export async function hasAccessToCashOffice(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<boolean> {
  return hasAccessToSalesHistory(supabase, userId, businessId)
}

/**
 * Check if user has accountant role for business
 * Accountants can move periods to closing, close, or lock periods
 * Note: Requires 'accountant' role to be added to business_users role constraint
 */
export async function isUserAccountant(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<boolean> {
  const role = await getUserRole(supabase, userId, businessId)
  // Business owner has full authority (including accountant functions)
  if (role === "owner") {
    return true
  }
  // Check if user has accountant role
  return role === "accountant"
}

/**
 * Check if user has accountant_readonly flag for business
 * Accountant readonly users have read-only access to accounting routes
 */
export async function isUserAccountantReadonly(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<boolean> {
  // First check if user is the business owner (owners have full access, not readonly)
  const { data: business } = await supabase
    .from("businesses")
    .select("owner_id")
    .eq("id", businessId)
    .maybeSingle()

  if (business && business.owner_id === userId) {
    return false // Owners are not readonly
  }

  // Check business_users table for accountant_readonly flag
  const { data, error } = await supabase
    .from("business_users")
    .select("accountant_readonly")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error || !data) {
    return false
  }

  // Return true if accountant_readonly flag is set to true
  return data.accountant_readonly === true
}



