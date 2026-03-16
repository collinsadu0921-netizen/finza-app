/**
 * Auto-Bind Store Utility
 * 
 * STORE CONTEXT AUTO-BINDING:
 * - If user has exactly one store → automatically set as activeStoreId
 * - Prevents unnecessary redirects to /select-store for single-store users
 * - Only applies to Admin/Manager users (cashiers have implicit store)
 * 
 * This function should be called during app bootstrap (ProtectedLayout) to ensure
 * store context is established before route guards check for store requirements.
 */

import { SupabaseClient } from "@supabase/supabase-js"
import { getCurrentBusiness } from "./business"
import { getUserRole } from "./userRoles"
import { getActiveStoreId, setActiveStoreId } from "./storeSession"
import { getStores } from "./stores"
import { isCashierAuthenticated } from "./cashierSession"

/**
 * Auto-bind single store for Admin/Manager users
 * If user has exactly one store, automatically set it as activeStoreId
 * 
 * @param supabase - Supabase client
 * @param userId - User ID
 * @returns true if store was auto-bound, false otherwise
 */
export async function autoBindSingleStore(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  try {
    // STORE CONTEXT: Cashiers have implicit store from cashier session (skip auto-bind)
    if (isCashierAuthenticated()) {
      return false
    }

    // Check if store is already set (don't override user's selection)
    const existingStoreId = getActiveStoreId()
    if (existingStoreId && existingStoreId !== 'all') {
      return false // Store already set, no need to auto-bind
    }

    // Get business
    const business = await getCurrentBusiness(supabase, userId)
    if (!business) {
      return false
    }

    // Get user role
    const role = await getUserRole(supabase, userId, business.id)
    
    // STORE CONTEXT: Only auto-bind for Admin/Manager (cashiers skipped above)
    if (role !== "admin" && role !== "owner" && role !== "manager") {
      return false
    }

    // Load all stores for business
    const allStores = await getStores(supabase, business.id)

    // STORE CONTEXT AUTO-BIND: If exactly one store exists, auto-set it
    if (allStores.length === 1) {
      const singleStore = allStores[0]
      setActiveStoreId(singleStore.id, singleStore.name)
      return true // Store was auto-bound
    }

    // Multiple stores or no stores - user must select manually
    return false
  } catch (error) {
    console.error("Error auto-binding single store:", error)
    return false
  }
}




