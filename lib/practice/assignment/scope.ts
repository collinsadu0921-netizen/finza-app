import type { SupabaseClient } from "@supabase/supabase-js"
import { evaluateEngagementState } from "@/lib/accounting/evaluateEngagementState"
import {
  CLIENT_NOT_ASSIGNED,
  canAssignTaskToUser,
  isClientInScope,
  isPracticeFirmRole,
  type PracticeFirmRole,
  resolveAuthorizedClientIds,
} from "./policy"

export type FirmUserClientScope = {
  firmId: string
  role: PracticeFirmRole
  effectiveBusinessIds: string[]
  assignedBusinessIds: string[]
  authorizedBusinessIds: string[]
  enforcementActive: boolean
}

type MembershipRow = { firm_id: string; role: string }

export async function loadMembership(
  supabase: SupabaseClient,
  userId: string,
  firmId?: string | null
): Promise<MembershipRow | null> {
  let query = supabase
    .from("accounting_firm_users")
    .select("firm_id, role")
    .eq("user_id", userId)
  if (firmId) query = query.eq("firm_id", firmId)
  const { data } = await query
  const rows = (data ?? []) as MembershipRow[]
  if (!rows.length) return null
  if (firmId) return rows.find((row) => row.firm_id === firmId) ?? null
  return [...rows].sort((a, b) => a.firm_id.localeCompare(b.firm_id))[0]
}

export async function loadFirmUserClientScope(
  supabase: SupabaseClient,
  opts: { userId: string; firmId: string; now?: Date }
): Promise<FirmUserClientScope | null> {
  const membership = await loadMembership(supabase, opts.userId, opts.firmId)
  if (!membership || !isPracticeFirmRole(membership.role)) return null

  const now = opts.now ?? new Date()
  const { data: engagements } = await supabase
    .from("firm_client_engagements")
    .select("client_business_id, status, effective_from, effective_to")
    .eq("accounting_firm_id", opts.firmId)

  const effectiveBusinessIds = [
    ...new Set(
      (engagements ?? [])
        .filter((row) =>
          evaluateEngagementState({
            engagement: {
              status: row.status,
              effective_from: row.effective_from,
              effective_to: row.effective_to,
            },
            now,
          }).effective
        )
        .map((row) => row.client_business_id as string)
    ),
  ]

  const [assignedRes, enforcementRes] = await Promise.all([
    supabase
      .from("accounting_firm_client_assignments")
      .select("client_business_id")
      .eq("firm_id", opts.firmId)
      .eq("user_id", opts.userId)
      .is("unassigned_at", null),
    supabase
      .from("accounting_firm_client_assignments")
      .select("id")
      .eq("firm_id", opts.firmId)
      .limit(1),
  ])

  const assignedBusinessIds = [
    ...new Set((assignedRes.data ?? []).map((row) => row.client_business_id as string)),
  ]
  const enforcementActive = (enforcementRes.data ?? []).length > 0

  return {
    firmId: opts.firmId,
    role: membership.role,
    effectiveBusinessIds,
    assignedBusinessIds,
    authorizedBusinessIds: resolveAuthorizedClientIds({
      role: membership.role,
      effectiveClientIds: effectiveBusinessIds,
      assignedClientIds: assignedBusinessIds,
      firmHasAssignmentRows: enforcementActive,
    }),
    enforcementActive,
  }
}

export async function getAuthorizedClientBusinessIdsForUser(
  supabase: SupabaseClient,
  userId: string,
  now?: Date
): Promise<string[]> {
  const { data: memberships } = await supabase
    .from("accounting_firm_users")
    .select("firm_id, role")
    .eq("user_id", userId)
  const ids = new Set<string>()
  for (const row of memberships ?? []) {
    const scope = await loadFirmUserClientScope(supabase, {
      userId,
      firmId: row.firm_id,
      now,
    })
    for (const id of scope?.authorizedBusinessIds ?? []) ids.add(id)
  }
  return [...ids]
}

export async function assertAssignedClientAccess(opts: {
  supabase: SupabaseClient
  userId: string
  firmId: string
  businessId: string
  role: PracticeFirmRole
}): Promise<{ allowed: boolean; reason: string }> {
  const [assignedRes, enforcementRes] = await Promise.all([
    opts.supabase
      .from("accounting_firm_client_assignments")
      .select("id")
      .eq("firm_id", opts.firmId)
      .eq("user_id", opts.userId)
      .eq("client_business_id", opts.businessId)
      .is("unassigned_at", null)
      .limit(1),
    opts.supabase
      .from("accounting_firm_client_assignments")
      .select("id")
      .eq("firm_id", opts.firmId)
      .limit(1),
  ])

  const allowed = isClientInScope({
    role: opts.role,
    businessId: opts.businessId,
    assigned: (assignedRes.data ?? []).length > 0,
    firmHasAssignmentRows: (enforcementRes.data ?? []).length > 0,
  })
  return { allowed, reason: allowed ? "ACTIVE" : CLIENT_NOT_ASSIGNED }
}

export async function assertTaskAssigneeAllowed(opts: {
  supabase: SupabaseClient
  firmId: string
  businessId: string
  assigneeUserId: string
}): Promise<{ allowed: boolean; reason: string }> {
  const { data: membership } = await opts.supabase
    .from("accounting_firm_users")
    .select("role")
    .eq("firm_id", opts.firmId)
    .eq("user_id", opts.assigneeUserId)
    .maybeSingle()
  if (!membership || !isPracticeFirmRole(membership.role)) {
    return { allowed: false, reason: "ASSIGNEE_NOT_FIRM_MEMBER" }
  }

  const [assignedRes, enforcementRes] = await Promise.all([
    opts.supabase
      .from("accounting_firm_client_assignments")
      .select("id")
      .eq("firm_id", opts.firmId)
      .eq("user_id", opts.assigneeUserId)
      .eq("client_business_id", opts.businessId)
      .is("unassigned_at", null)
      .limit(1),
    opts.supabase
      .from("accounting_firm_client_assignments")
      .select("id")
      .eq("firm_id", opts.firmId)
      .limit(1),
  ])

  const allowed = canAssignTaskToUser({
    assigneeRole: membership.role,
    assigneeAssignedToClient: (assignedRes.data ?? []).length > 0,
    firmHasAssignmentRows: (enforcementRes.data ?? []).length > 0,
  })
  return { allowed, reason: allowed ? "ok" : CLIENT_NOT_ASSIGNED }
}
