/**
 * Audit Logging Utility
 * Automatic audit trail for all business operations
 */

import { createSupabaseServerClient } from "./supabaseServer"
import { NextRequest } from "next/server"

export interface AuditLogParams {
  businessId: string
  userId?: string | null
  actionType: string
  entityType: string
  entityId?: string | null
  oldValues?: Record<string, any> | null
  newValues?: Record<string, any> | null
  ipAddress?: string | null
  userAgent?: string | null
  description?: string | null
  request?: NextRequest | Request | null
}

/**
 * Helper function to automatically log audit entries
 * This is the main function to use for all audit logging
 */
export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient()

    // Extract IP and user agent from request if provided
    let ipAddress = params.ipAddress
    let userAgent = params.userAgent

    if (params.request && !ipAddress) {
      ipAddress = getIpAddress(params.request)
    }

    if (params.request && !userAgent) {
      userAgent = getUserAgent(params.request)
    }

    // Get current user if userId not provided
    let userId = params.userId
    if (!userId) {
      const { data: { user } } = await supabase.auth.getUser()
      userId = user?.id || null
    }

    // Insert via SECURITY DEFINER function so RLS does not block (audit_logs RLS stays enabled)
    const { error } = await supabase.rpc("create_audit_log", {
      p_business_id: params.businessId,
      p_user_id: userId,
      p_action_type: params.actionType,
      p_entity_type: params.entityType,
      p_entity_id: params.entityId || null,
      p_old_values: params.oldValues || null,
      p_new_values: params.newValues || null,
      p_ip_address: ipAddress || null,
      p_user_agent: userAgent || null,
      p_description: params.description || null,
    })

    if (error) {
      console.error("Error creating audit log:", error)
    }
  } catch (error) {
    // Don't throw errors - audit logging should never break the main flow
    console.error("Error creating audit log:", error)
  }
}

/**
 * Create an audit log entry (legacy function, use logAudit instead)
 * This is used for actions that aren't automatically logged by database triggers
 * (e.g., WhatsApp sends, email sends, PDF downloads, etc.)
 */
export async function createAuditLog(params: AuditLogParams): Promise<void> {
  // Use the new logAudit function
  return logAudit(params)
}

/**
 * Helper to get IP address from request headers
 */
export function getIpAddress(request: Request | NextRequest): string | null {
  if (request instanceof NextRequest) {
    const forwarded = request.headers.get("x-forwarded-for")
    const realIp = request.headers.get("x-real-ip")
    return forwarded?.split(",")[0] || realIp || null
  }
  const forwarded = request.headers.get("x-forwarded-for")
  const realIp = request.headers.get("x-real-ip")
  return forwarded?.split(",")[0] || realIp || null
}

/**
 * Helper to get user agent from request headers
 */
export function getUserAgent(request: Request | NextRequest): string | null {
  return request.headers.get("user-agent") || null
}


