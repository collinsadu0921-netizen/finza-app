import type { NextRequest } from "next/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { getIpAddress, getUserAgent } from "@/lib/auditLog"

/**
 * Audit log for proposal events when there is no authenticated user (public client actions).
 * Uses service role RPC — must only be called after authorization is proven (e.g. valid public token).
 */
export async function logProposalAuditPublic(params: {
  businessId: string
  actionType: string
  entityId: string
  newValues?: Record<string, unknown> | null
  request?: NextRequest | Request | null
}): Promise<void> {
  try {
    const admin = getSupabaseServiceRoleClient()
    if (!admin) {
      console.error("logProposalAuditPublic: no service role client")
      return
    }
    const ip = params.request ? getIpAddress(params.request) : null
    const ua = params.request ? getUserAgent(params.request) : null
    const { error } = await admin.rpc("create_audit_log", {
      p_business_id: params.businessId,
      p_user_id: null,
      p_action_type: params.actionType,
      p_entity_type: "proposal",
      p_entity_id: params.entityId,
      p_old_values: null,
      p_new_values: params.newValues || null,
      p_ip_address: ip,
      p_user_agent: ua,
      p_description: null,
    })
    if (error) console.error("logProposalAuditPublic:", error)
  } catch (e) {
    console.error("logProposalAuditPublic:", e)
  }
}
