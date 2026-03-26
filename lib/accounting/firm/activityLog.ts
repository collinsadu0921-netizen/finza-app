/**
 * Firm Activity Logging Utility
 * Logs firm-level actions to accounting_firm_activity_logs table
 * Also provides utility functions for firm membership queries
 */

import { SupabaseClient } from "@supabase/supabase-js"

/**
 * Get all firm IDs that a user belongs to
 * @param supabase - Supabase client
 * @param userId - User ID
 * @returns Array of firm IDs
 */
export async function getUserFirmIds(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  try {
    const { data: firmUsers, error } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("user_id", userId)

    if (error) {
      console.error("Error fetching user firm IDs:", error)
      return []
    }

    return (firmUsers || []).map((fu) => fu.firm_id)
  } catch (error) {
    console.error("Error in getUserFirmIds:", error)
    return []
  }
}

export interface LogFirmActivityParams {
  supabase: SupabaseClient
  firmId: string
  actorUserId: string
  actionType: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, any> | null
}

/**
 * Log a firm-level activity to the audit trail
 * 
 * This function inserts a record into accounting_firm_activity_logs.
 * The table is append-only (no updates or deletes allowed).
 * 
 * @param params - Activity log parameters
 */
export async function logFirmActivity(
  params: LogFirmActivityParams
): Promise<void> {
  try {
    const { supabase, firmId, actorUserId, actionType, entityType, entityId, metadata } = params

    // Insert into accounting_firm_activity_logs
    const { error } = await supabase
      .from("accounting_firm_activity_logs")
      .insert({
        firm_id: firmId,
        actor_user_id: actorUserId,
        action_type: actionType,
        entity_type: entityType,
        entity_id: entityId || null,
        metadata: metadata || {},
      })

    if (error) {
      console.error("Error creating firm activity log:", error)
      // Don't throw - activity logging should not break the main flow
    }
  } catch (error) {
    // Don't throw errors - activity logging should never break the main flow
    console.error("Error creating firm activity log:", error)
  }
}

/**
 * Log a blocked action attempt (e.g. insufficient authority).
 * Wrapper around logFirmActivity with event_type BLOCKED_ACTION_ATTEMPT.
 * Does not throw; if firmId is missing, skips logging silently.
 */
export async function logBlockedActionAttempt(
  supabase: any,
  firmId: string | null | undefined,
  userId: string,
  action: string,
  reasonCode: string,
  requiredEngagementAccess?: string,
  requiredFirmRole?: string,
  businessId?: string
) {
  try {
    if (!firmId) return

    await logFirmActivity({
      supabase,
      firmId,
      actorUserId: userId,
      actionType: "BLOCKED_ACTION_ATTEMPT",
      entityType: "blocked_attempt",
      entityId: businessId ?? null,
      metadata: {
        action,
        reason: reasonCode,
        requiredEngagementAccess,
        requiredFirmRole,
        businessId
      }
    })
  } catch {
    // never throw
  }
}

/**
 * Log a blocked unauthorized access attempt (redirect to /accounting/access-denied).
 * Caller has no firm context, so we log to console for security probing detection.
 * Payload: user_id, attempted_path, timestamp, workspace_detected.
 */
export function logAccessDeniedAttempt(
  userId: string,
  attemptedPath: string,
  workspaceDetected: string
): void {
  try {
    const payload = {
      user_id: userId,
      attempted_path: attemptedPath,
      timestamp: new Date().toISOString(),
      workspace_detected: workspaceDetected,
    }
    console.warn("[ACCESS_DENIED]", JSON.stringify(payload))
  } catch {
    // never throw
  }
}
