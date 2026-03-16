import { SupabaseClient } from "@supabase/supabase-js"
import { getUserRole } from "./userRoles"

/**
 * Get the current user's store assignment
 * Returns null if user is owner/admin (can access all stores)
 * Returns store_id string if user is manager/cashier (restricted to one store)
 * Returns null if user has no store assigned (backward compatibility - will need store assignment)
 */
export async function getUserStore(
  supabase: SupabaseClient,
  businessId: string,
  userId: string
): Promise<string | null> {
  try {
    const role = await getUserRole(supabase, userId, businessId)
    
    // Owner/admin can access all stores (return null = no restriction)
    if (role === "owner" || role === "admin") {
      return null // No store restriction - can access all stores
    }

    // Manager/cashier: Get their assigned store
    const { data: user } = await supabase
      .from("users")
      .select("store_id")
      .eq("id", userId)
      .maybeSingle()

    const userStoreId = user?.store_id || null
    
    // If manager/cashier has no store_id, return null (backward compatibility)
    // The UI should handle this case and show appropriate message
    return userStoreId
  } catch (error) {
    console.error("Error getting user store:", error)
    // On error, return null (fail open for backward compatibility)
    return null
  }
}

/**
 * Get all stores for a business
 */
export async function getStores(
  supabase: SupabaseClient,
  businessId: string
) {
  const { data, error } = await supabase
    .from("stores")
    .select("*")
    .eq("business_id", businessId)
    .order("name", { ascending: true })

  if (error) throw error
  return data || []
}

/**
 * Get a single store by ID
 */
export async function getStore(
  supabase: SupabaseClient,
  storeId: string
) {
  const { data, error } = await supabase
    .from("stores")
    .select("*")
    .eq("id", storeId)
    .single()

  if (error) throw error
  return data
}

/**
 * Check if user can access a specific store
 */
export async function canAccessStore(
  supabase: SupabaseClient,
  businessId: string,
  userId: string,
  storeId: string
): Promise<boolean> {
  const userStore = await getUserStore(supabase, businessId, userId)
  
  // Superadmin can access all stores
  if (userStore === null) {
    return true
  }

  // Regular user can only access their assigned store
  return userStore === storeId
}

/**
 * Get store filter for queries
 * Returns store_id filter if user is restricted to one store, null otherwise
 */
export async function getStoreFilter(
  supabase: SupabaseClient,
  businessId: string,
  userId: string
): Promise<string | null> {
  return await getUserStore(supabase, businessId, userId)
}

