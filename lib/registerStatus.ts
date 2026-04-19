/**
 * Register Status Utilities
 * Check if register is open for a store
 */

import { SupabaseClient } from "@supabase/supabase-js"

export interface OpenRegisterSession {
  id: string
  register_id: string
  user_id: string
  store_id: string | null
  started_at: string
  /** Opening float for this session (e.g. close-register UI) */
  opening_float?: number
  registers?: {
    id: string
    name: string
  } | null
  /** Present when query embeds stores(name); useful when listing sessions across stores */
  stores?: {
    name: string
  } | null
}

/**
 * Get ALL open register sessions for a store or business
 * Returns array of open sessions (supports multiple registers)
 * 
 * CRITICAL: storeId null means "ANY store" - query entire business
 * This allows admin in "All stores" mode to see open status if ANY register is open
 * 
 * CRITICAL: Do NOT filter by date (started_at >= startOfDay)
 * Register status is determined by status='open' only, regardless of when it started
 * A register opened yesterday but still open today should show as OPEN
 */
export async function getAllOpenRegisterSessions(
  supabase: SupabaseClient,
  businessId: string,
  storeId: string | null
): Promise<OpenRegisterSession[]> {
  // Build query - storeId null means query ALL stores for this business
  let query = supabase
    .from("cashier_sessions")
    .select(`
      id,
      register_id,
      user_id,
      store_id,
      started_at,
      opening_float,
      registers (
        id,
        name
      ),
      stores (
        name
      )
    `)
    .eq("business_id", businessId)
    .eq("status", "open")
  
  // CRITICAL: Only filter by store_id if storeId is provided
  // If storeId is null, query returns sessions from ALL stores (admin global mode)
  if (storeId) {
    query = query.eq("store_id", storeId)
  }
  
  // CRITICAL: Do NOT filter by started_at date
  // Register status = 'open' means open regardless of when it started
  // Removing .gte("started_at", startOfDay) filter
  const { data, error } = await query.order("started_at", { ascending: false })

  if (error && error.code !== "PGRST116") {
    console.error("Error checking register sessions:", error)
    return []
  }

  if (!data || data.length === 0) {
    return []
  }

  // Normalize all sessions
  return data.map((session: any) => ({
    id: session.id,
    register_id: session.register_id,
    user_id: session.user_id,
    store_id: session.store_id,
    started_at: session.started_at,
    opening_float:
      session.opening_float !== null && session.opening_float !== undefined
        ? Number(session.opening_float)
        : undefined,
    registers: Array.isArray(session.registers)
      ? session.registers[0] || null
      : session.registers || null,
    stores: Array.isArray(session.stores) ? session.stores[0] || null : session.stores || null,
  }))
}

/**
 * Check if there's an open register session for a store
 * Returns the FIRST session if open, null otherwise
 * (For backward compatibility - use getAllOpenRegisterSessions for multiple)
 */
export async function getOpenRegisterSession(
  supabase: SupabaseClient,
  businessId: string,
  storeId: string | null
): Promise<OpenRegisterSession | null> {
  const sessions = await getAllOpenRegisterSessions(supabase, businessId, storeId)
  return sessions.length > 0 ? sessions[0] : null
}

/**
 * Check if register is open for current user and store
 */
export async function getCurrentUserOpenSession(
  supabase: SupabaseClient,
  userId: string,
  businessId: string,
  storeId: string | null
): Promise<OpenRegisterSession | null> {
  if (!storeId) {
    return null
  }

  // Get today's date range
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const startOfDay = today.toISOString()

  let query = supabase
    .from("cashier_sessions")
    .select(`
      id,
      register_id,
      user_id,
      store_id,
      started_at,
      registers (
        id,
        name
      )
    `)
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .eq("status", "open")
    .eq("store_id", storeId)
    .gte("started_at", startOfDay)
    .maybeSingle()

  const { data, error } = await query

  if (error && error.code !== "PGRST116") {
    console.error("Error checking user register session:", error)
    return null
  }

  if (!data) {
    return null
  }

  // Normalize registers field (can be array or single object)
  const normalizedData: OpenRegisterSession = {
    id: data.id,
    register_id: data.register_id,
    user_id: data.user_id,
    store_id: data.store_id,
    started_at: data.started_at,
    registers: Array.isArray(data.registers) 
      ? data.registers[0] || null
      : data.registers || null,
  }

  return normalizedData
}









