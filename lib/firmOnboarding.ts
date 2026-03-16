/**
 * Firm Onboarding Helpers
 * Provides functions to check and manage firm onboarding status
 */

import { SupabaseClient } from "@supabase/supabase-js"

export type FirmOnboardingStatus = "pending" | "in_progress" | "completed"

export interface FirmOnboardingData {
  onboarding_status: FirmOnboardingStatus
  onboarding_completed_at: string | null
  onboarding_completed_by: string | null
  legal_name: string | null
  jurisdiction: string | null
  reporting_standard: string | null
  default_accounting_standard: string | null
}

/**
 * Check if a firm has completed onboarding
 * @param supabase - Supabase client
 * @param firmId - Firm ID to check
 * @returns true if onboarding is completed, false otherwise
 */
export async function isFirmOnboardingComplete(
  supabase: SupabaseClient,
  firmId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("accounting_firms")
      .select("onboarding_status")
      .eq("id", firmId)
      .maybeSingle()

    if (error) {
      console.error("Error checking firm onboarding status:", error)
      return false
    }

    return data?.onboarding_status === "completed"
  } catch (error) {
    console.error("Error in isFirmOnboardingComplete:", error)
    return false
  }
}

/**
 * Get firm onboarding data
 * @param supabase - Supabase client
 * @param firmId - Firm ID
 * @returns Firm onboarding data or null if not found
 */
export async function getFirmOnboardingData(
  supabase: SupabaseClient,
  firmId: string
): Promise<FirmOnboardingData | null> {
  try {
    const { data, error } = await supabase
      .from("accounting_firms")
      .select(
        "onboarding_status, onboarding_completed_at, onboarding_completed_by, legal_name, jurisdiction, reporting_standard, default_accounting_standard"
      )
      .eq("id", firmId)
      .maybeSingle()

    if (error) {
      console.error("Error fetching firm onboarding data:", error)
      return null
    }

    return data as FirmOnboardingData | null
  } catch (error) {
    console.error("Error in getFirmOnboardingData:", error)
    return null
  }
}

/**
 * Check if user is a Partner in the firm
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param firmId - Firm ID
 * @returns true if user is a Partner, false otherwise
 */
export async function isUserFirmPartner(
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

    if (error) {
      console.error("Error checking firm partner status:", error)
      return false
    }

    return data?.role === "partner"
  } catch (error) {
    console.error("Error in isUserFirmPartner:", error)
    return false
  }
}

/**
 * Get the firm ID for a user accessing a business via firm
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param businessId - Business ID
 * @returns Firm ID if user accesses business via firm, null otherwise
 */
export async function getFirmIdForBusiness(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<string | null> {
  try {
    // Check if user accesses this business via a firm
    const { data, error } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      return null
    }

    // Check if this firm has active engagement with the business
    const { data: engagement, error: engagementError } = await supabase
      .from("firm_client_engagements")
      .select("accounting_firm_id")
      .eq("accounting_firm_id", data.firm_id)
      .eq("client_business_id", businessId)
      .eq("status", "active")
      .maybeSingle()

    if (engagementError || !engagement) {
      return null
    }

    return data.firm_id
  } catch (error) {
    console.error("Error in getFirmIdForBusiness:", error)
    return null
  }
}

/**
 * Check if firm onboarding is required for an action
 * This should be called before allowing accounting actions or client additions
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param businessId - Business ID (for accounting actions) or null (for firm-level actions)
 * @param firmId - Firm ID (optional, will be looked up if not provided)
 * @returns Object with isComplete flag and error message if not complete
 */
export async function checkFirmOnboardingForAction(
  supabase: SupabaseClient,
  userId: string,
  businessId: string | null = null,
  firmId: string | null = null
): Promise<{ isComplete: boolean; error?: string; firmId?: string }> {
  try {
    // If firmId not provided, try to get it
    if (!firmId && businessId) {
      firmId = await getFirmIdForBusiness(supabase, userId, businessId)
    }

    // If still no firmId, check if user belongs to any firm
    if (!firmId) {
      const { data: firmUser } = await supabase
        .from("accounting_firm_users")
        .select("firm_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle()

      if (firmUser) {
        firmId = firmUser.firm_id
      }
    }

    // If no firm found, allow action (user might be business owner, not firm user)
    if (!firmId) {
      return { isComplete: true }
    }

    // Check onboarding status
    const isComplete = await isFirmOnboardingComplete(supabase, firmId)
    
    if (!isComplete) {
      return {
        isComplete: false,
        error: "Firm onboarding must be completed before performing this action. Please complete onboarding first.",
        firmId,
      }
    }

    return { isComplete: true, firmId }
  } catch (error) {
    console.error("Error in checkFirmOnboardingForAction:", error)
    // On error, allow action (fail open for safety, but log error)
    return { isComplete: true }
  }
}

/**
 * Check engagement access for a firm-client relationship
 * This should be called before allowing access to client data
 * @param supabase - Supabase client
 * @param firmId - Firm ID
 * @param businessId - Business ID
 * @param requiredAccess - Required access level ('read', 'write', or 'approve')
 * @returns Object with hasAccess flag and error message if access denied
 */
export async function checkEngagementAccessForAction(
  supabase: SupabaseClient,
  firmId: string,
  businessId: string,
  requiredAccess: "read" | "write" | "approve" = "read"
): Promise<{ hasAccess: boolean; error?: string }> {
  try {
    const { checkEngagementAccess } = await import("./firmEngagements")
    
    const hasAccess = await checkEngagementAccess(
      supabase,
      firmId,
      businessId,
      requiredAccess
    )

    if (!hasAccess) {
      // Get engagement status for better error message
      const { getActiveEngagement } = await import("./firmEngagements")
      const engagement = await getActiveEngagement(supabase, firmId, businessId)
      
      if (!engagement) {
        return {
          hasAccess: false,
          error: "No active engagement found for this client. Please create an engagement first.",
        }
      }

      if (engagement.status === "pending") {
        return {
          hasAccess: false,
          error: "Engagement is pending client acceptance. No access until engagement is accepted.",
        }
      }

      if (engagement.status === "suspended") {
        return {
          hasAccess: false,
          error: "Engagement is suspended. Access is temporarily disabled.",
        }
      }

      if (engagement.status === "terminated") {
        return {
          hasAccess: false,
          error: "Engagement is terminated. Access is permanently disabled.",
        }
      }

      // Check if engagement is effective
      const today = new Date().toISOString().split("T")[0]
      if (engagement.effective_from > today) {
        return {
          hasAccess: false,
          error: `Engagement is not yet effective. Effective date: ${engagement.effective_from}`,
        }
      }

      if (engagement.effective_to && engagement.effective_to < today) {
        return {
          hasAccess: false,
          error: `Engagement has expired. Expired on: ${engagement.effective_to}`,
        }
      }

      // Check access level
      const accessHierarchy = ["read", "write", "approve"]
      const requiredIndex = accessHierarchy.indexOf(requiredAccess)
      const engagementIndex = accessHierarchy.indexOf(engagement.access_level)

      if (engagementIndex < requiredIndex) {
        return {
          hasAccess: false,
          error: `This action requires '${requiredAccess}' access, but engagement only has '${engagement.access_level}' access.`,
        }
      }
    }

    return { hasAccess: true }
  } catch (error) {
    console.error("Error in checkEngagementAccessForAction:", error)
    // On error, deny access (fail closed for security)
    return {
      hasAccess: false,
      error: "Error checking engagement access",
    }
  }
}
