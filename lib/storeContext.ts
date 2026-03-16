/**
 * Store Context Helper
 * Determines the effective store_id based on user role and permissions
 */

import { SupabaseClient } from "@supabase/supabase-js"
import { getUserRole } from "./userRoles"
import { getActiveStoreId } from "./storeSession"

/**
 * Gets the effective store_id for queries based on user role
 * 
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param businessId - Business ID
 * @param selectedStoreId - Store ID from session/selector (can be null for admin global mode)
 * @returns Effective store_id or null (null = global mode for admin)
 */
export async function getEffectiveStoreId(
  supabase: SupabaseClient,
  userId: string,
  businessId: string,
  selectedStoreId?: string | null
): Promise<string | null> {
  const role = await getUserRole(supabase, userId, businessId)
  
  // Admin: Can work in global mode (null) or filter by selected store
  if (role === "owner" || role === "admin") {
    // If no store selected, return null (global mode)
    // If store selected, return that store_id
    return selectedStoreId || null
  }
  
  // Store Manager / Cashier: Always locked to their assigned store
  const { data: userData } = await supabase
    .from("users")
    .select("store_id")
    .eq("id", userId)
    .maybeSingle()
  
  if (!userData?.store_id) {
    // User should have a store assigned, but if not, return null to block access
    console.warn(`User ${userId} (role: ${role}) has no store_id assigned`)
    return null
  }
  
  return userData.store_id
}

/**
 * Gets the effective store_id from session storage (client-side)
 * For use in client components where we already know the role
 * 
 * @param userRole - User role (owner, admin, manager, cashier)
 * @param selectedStoreId - Store ID from session storage
 * @param userStoreId - User's assigned store_id from database
 * @returns Effective store_id or null
 */
export function getEffectiveStoreIdClient(
  userRole: string | null,
  selectedStoreId: string | null,
  userStoreId: string | null
): string | null {
  // Admin/Owner: Can work in global mode (null) or filter by selected store
  if (userRole === "owner" || userRole === "admin") {
    return selectedStoreId || null // null = global mode
  }
  
  // Store Manager / Cashier: Always locked to their assigned store
  if (!userStoreId) {
    console.warn(`User (role: ${userRole}) has no store_id assigned`)
    return null
  }
  
  return userStoreId
}

/**
 * Checks if user should see store selector
 * Only admins and owners should see it
 */
export function shouldShowStoreSelector(userRole: string | null): boolean {
  return userRole === "owner" || userRole === "admin"
}

/**
 * Checks if user can access global mode (no store filter)
 * Only admins and owners can
 */
export function canAccessGlobalMode(userRole: string | null): boolean {
  return userRole === "owner" || userRole === "admin"
}

