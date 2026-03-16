/**
 * Store Context Guard (DEPRECATED for redirects)
 * 
 * NOTE: Store context checks are now centralized in resolveAccess() in accessControl.ts
 * This file is kept for backward compatibility, but redirects should NOT be performed here.
 * 
 * Store context validation is handled in ProtectedLayout via resolveAccess().
 * Pages should NOT call these functions to perform redirects.
 * 
 * If you need to validate store context in a component, use these functions
 * to return boolean/error status only - DO NOT redirect.
 */

import { SupabaseClient } from "@supabase/supabase-js"
import { getUserRole } from "./userRoles"
import { getActiveStoreId } from "./storeSession"

export interface StoreContextGuardResult {
  requiresStore: boolean
  hasStore: boolean
  redirectTo?: string
  storeId: string | null
}

/**
 * Check if route requires store context and if user has valid store
 * 
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param businessId - Business ID
 * @param routePath - Current route path
 * @param requireStore - Whether route explicitly requires a store (true = store required, false = global mode allowed)
 * @returns Guard result with store context status
 */
export async function checkStoreContext(
  supabase: SupabaseClient,
  userId: string,
  businessId: string,
  routePath: string,
  requireStore: boolean = true
): Promise<StoreContextGuardResult> {
  // Get user role
  const role = await getUserRole(supabase, userId, businessId)

  // STORE CONTEXT: Cashiers have implicit store from cashier session
  // They should never reach store-guarded routes (blocked by route guards)
  if (role === "cashier") {
    return {
      requiresStore: false,
      hasStore: true,
      storeId: null, // Cashiers use cashier session store
    }
  }

  // STORE CONTEXT: Admin/Owner can work in global mode (null) if route allows
  if ((role === "admin" || role === "owner") && !requireStore) {
    const activeStoreId = getActiveStoreId()
    return {
      requiresStore: false,
      hasStore: true, // Global mode is valid
      storeId: activeStoreId,
    }
  }

  // STORE CONTEXT: Admin/Owner/Manager need store if route requires it
  if (requireStore) {
    // Check for assigned store_id (for managers)
    const { data: userData } = await supabase
      .from("users")
      .select("store_id")
      .eq("id", userId)
      .maybeSingle()

    const assignedStoreId = userData?.store_id || null
    const activeStoreId = getActiveStoreId()

    // Manager: Must have assigned store_id OR selected store
    if (role === "manager") {
      const storeId = activeStoreId || assignedStoreId
      if (!storeId || storeId === "all") {
        return {
          requiresStore: true,
          hasStore: false,
          redirectTo: `/select-store?return=${encodeURIComponent(routePath)}`,
          storeId: null,
        }
      }
      return {
        requiresStore: true,
        hasStore: true,
        storeId,
      }
    }

    // Admin/Owner: Must have selected store (can't use global mode for store-specific routes)
    if (role === "admin" || role === "owner") {
      if (!activeStoreId || activeStoreId === "all") {
        return {
          requiresStore: true,
          hasStore: false,
          redirectTo: `/select-store?return=${encodeURIComponent(routePath)}`,
          storeId: null,
        }
      }
      return {
        requiresStore: true,
        hasStore: true,
        storeId: activeStoreId,
      }
    }
  }

  // Default: No store required
  return {
    requiresStore: false,
    hasStore: true,
    storeId: null,
  }
}

/**
 * Client-side store context guard (for React components)
 * Uses role from props instead of fetching from database
 * 
 * @param userRole - User role (from component state)
 * @param userStoreId - User's assigned store_id (from database, for managers)
 * @param requireStore - Whether route requires store (true = store required)
 * @param routePath - Current route path
 * @returns Guard result
 */
export function checkStoreContextClient(
  userRole: string | null,
  userStoreId: string | null,
  requireStore: boolean = true,
  routePath: string
): StoreContextGuardResult {
  // STORE CONTEXT: Cashiers have implicit store (should not reach here)
  if (userRole === "cashier") {
    return {
      requiresStore: false,
      hasStore: true,
      storeId: null,
    }
  }

  // STORE CONTEXT: Admin/Owner can work in global mode if route allows
  if ((userRole === "admin" || userRole === "owner") && !requireStore) {
    const activeStoreId = getActiveStoreId()
    return {
      requiresStore: false,
      hasStore: true,
      storeId: activeStoreId,
    }
  }

  // STORE CONTEXT: Route requires store
  if (requireStore) {
    const activeStoreId = getActiveStoreId()

    // Manager: Must have assigned store_id OR selected store
    if (userRole === "manager") {
      const storeId = activeStoreId || userStoreId
      if (!storeId || storeId === "all") {
        return {
          requiresStore: true,
          hasStore: false,
          redirectTo: `/select-store?return=${encodeURIComponent(routePath)}`,
          storeId: null,
        }
      }
      return {
        requiresStore: true,
        hasStore: true,
        storeId,
      }
    }

    // Admin/Owner: Must have selected store
    if (userRole === "admin" || userRole === "owner") {
      if (!activeStoreId || activeStoreId === "all") {
        return {
          requiresStore: true,
          hasStore: false,
          redirectTo: `/select-store?return=${encodeURIComponent(routePath)}`,
          storeId: null,
        }
      }
      return {
        requiresStore: true,
        hasStore: true,
        storeId: activeStoreId,
      }
    }
  }

  // Default: No store required
  return {
    requiresStore: false,
    hasStore: true,
    storeId: null,
  }
}

