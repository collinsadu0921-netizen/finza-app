/**
 * Firm Client Engagement Helpers
 * Provides functions to manage and check firm-client engagements
 */

import { SupabaseClient } from "@supabase/supabase-js"

export type EngagementStatus = "pending" | "accepted" | "active" | "suspended" | "terminated"
export type EngagementAccessLevel = "read" | "write" | "approve"

export interface Engagement {
  id: string
  accounting_firm_id: string
  client_business_id: string
  status: EngagementStatus
  access_level: EngagementAccessLevel
  effective_from: string
  effective_to: string | null
  created_by: string
  accepted_by: string | null
  accepted_at: string | null
  created_at: string
  updated_at: string
}

export interface EngagementCreateParams {
  firm_id: string
  business_id: string
  access_level: EngagementAccessLevel
  effective_from: string // DATE format (YYYY-MM-DD)
  effective_to?: string | null // DATE format (YYYY-MM-DD) or null
}

/**
 * Check if a firm has active engagement with a business
 * @param supabase - Supabase client
 * @param firmId - Firm ID
 * @param businessId - Business ID
 * @param checkDate - Date to check (defaults to today)
 * @returns Engagement if active and effective, null otherwise
 */
export async function getActiveEngagement(
  supabase: SupabaseClient,
  firmId: string,
  businessId: string,
  checkDate: string = new Date().toISOString().split("T")[0]
): Promise<Engagement | null> {
  try {
    const { data, error } = await supabase.rpc("get_active_engagement", {
      p_firm_id: firmId,
      p_business_id: businessId,
      p_check_date: checkDate,
    })

    if (error) {
      console.error("Error getting active engagement:", error)
      return null
    }

    if (!data || data.length === 0) {
      return null
    }

    // Fetch full engagement record
    const { data: engagement, error: fetchError } = await supabase
      .from("firm_client_engagements")
      .select("*")
      .eq("id", data[0].id)
      .maybeSingle()

    if (fetchError || !engagement) {
      return null
    }

    return engagement as Engagement
  } catch (error) {
    console.error("Error in getActiveEngagement:", error)
    return null
  }
}

/**
 * Check if firm has required access level for business via engagement
 * @param supabase - Supabase client
 * @param firmId - Firm ID
 * @param businessId - Business ID
 * @param requiredAccess - Required access level
 * @param checkDate - Date to check (defaults to today)
 * @returns true if access is granted, false otherwise
 */
export async function checkEngagementAccess(
  supabase: SupabaseClient,
  firmId: string,
  businessId: string,
  requiredAccess: EngagementAccessLevel,
  checkDate: string = new Date().toISOString().split("T")[0]
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("check_engagement_access", {
      p_firm_id: firmId,
      p_business_id: businessId,
      p_required_access: requiredAccess,
      p_check_date: checkDate,
    })

    if (error) {
      console.error("Error checking engagement access:", error)
      return false
    }

    return data === true
  } catch (error) {
    console.error("Error in checkEngagementAccess:", error)
    return false
  }
}

/**
 * Check if engagement is effective on a given date
 * @param engagement - Engagement object
 * @param checkDate - Date to check (YYYY-MM-DD format, defaults to today)
 * @returns true if engagement is effective, false otherwise
 */
export function isEngagementEffective(
  engagement: Engagement | null,
  checkDate: string = new Date().toISOString().split("T")[0]
): boolean {
  if (!engagement) {
    return false
  }

  // Effective = accepted or active (client approved) and within date range
  if (engagement.status !== "accepted" && engagement.status !== "active") {
    return false
  }

  // Check effective_from
  if (engagement.effective_from > checkDate) {
    return false
  }

  // Check effective_to (if set)
  if (engagement.effective_to && engagement.effective_to < checkDate) {
    return false
  }

  return true
}

/**
 * Get all engagements for a firm
 * @param supabase - Supabase client
 * @param firmId - Firm ID
 * @param status - Optional status filter
 * @returns Array of engagements
 */
export async function getFirmEngagements(
  supabase: SupabaseClient,
  firmId: string,
  status?: EngagementStatus
): Promise<Engagement[]> {
  try {
    let query = supabase
      .from("firm_client_engagements")
      .select("*")
      .eq("accounting_firm_id", firmId)
      .order("created_at", { ascending: false })

    if (status) {
      query = query.eq("status", status)
    }

    const { data, error } = await query

    if (error) {
      console.error("Error fetching firm engagements:", error)
      return []
    }

    return (data || []) as Engagement[]
  } catch (error) {
    console.error("Error in getFirmEngagements:", error)
    return []
  }
}

/**
 * Get engagement by ID
 * @param supabase - Supabase client
 * @param engagementId - Engagement ID
 * @returns Engagement or null
 */
export async function getEngagementById(
  supabase: SupabaseClient,
  engagementId: string
): Promise<Engagement | null> {
  try {
    const { data, error } = await supabase
      .from("firm_client_engagements")
      .select("*")
      .eq("id", engagementId)
      .maybeSingle()

    if (error) {
      console.error("Error fetching engagement:", error)
      return null
    }

    return data as Engagement | null
  } catch (error) {
    console.error("Error in getEngagementById:", error)
    return null
  }
}

/**
 * Check if user can create engagements (Partner or Senior role)
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param firmId - Firm ID
 * @returns true if user can create engagements
 */
export async function canUserCreateEngagements(
  supabase: SupabaseClient,
  userId: string,
  firmId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("accounting_firm_users")
      .select("role")
      .eq("firm_id", firmId)
      .eq("user_id", userId)
      .maybeSingle()

    if (error || !data) {
      return false
    }

    // Partners and Seniors can create engagements
    return data.role === "partner" || data.role === "senior"
  } catch (error) {
    console.error("Error in canUserCreateEngagements:", error)
    return false
  }
}
