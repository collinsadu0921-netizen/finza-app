/**
 * Canonical Accounting Authority Engine (firm-user path only).
 * Single source of truth for firm + engagement authority. No businesses table, no session.
 * Engagement state is determined solely by evaluateEngagementState (Wave 15).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { evaluateEngagementState } from "@/lib/accounting/evaluateEngagementState"
import {
  hasPortfolioWideVisibility,
  isPracticeFirmRole,
} from "@/lib/practice/assignment/policy"
import {
  assertAssignedClientAccess,
  getAuthorizedClientBusinessIdsForUser,
} from "@/lib/practice/assignment/scope"
import { timedStepMs } from "@/lib/server/routeDiagnostics"

export type AccessLevel = "read" | "write" | "approve"

export type AuthorityQueryTimings = {
  membership_ms: number
  engagement_ms: number
  assignment_ms: number
}

export type FirmMembershipRow = { firm_id: string; role: string }

export type AuthorityResult = {
  allowed: boolean
  level: AccessLevel | null
  reason: string
  firmId: string | null
  engagementId: string | null
  engagementStatus: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
  practiceRole: string | null
  debug: Record<string, unknown>
  queryTimings: AuthorityQueryTimings
}

const ACCESS_ORDER: AccessLevel[] = ["read", "write", "approve"]

function levelSatisfies(granted: AccessLevel, required: AccessLevel): boolean {
  const g = ACCESS_ORDER.indexOf(granted)
  const r = ACCESS_ORDER.indexOf(required)
  return g >= r
}

type EngagementRow = {
  id: string
  accounting_firm_id: string
  client_business_id: string
  status: string
  access_level: string
  effective_from: string
  effective_to: string | null
}

/**
 * Find the best engagement row for (firmId, businessId) from a list.
 * Priority: 1) status accepted/active AND within effective dates, 2) accepted/active, 3) any.
 */
function pickBestEngagement(
  rows: EngagementRow[],
  checkDate: string
): { row: EngagementRow; inWindow: boolean } | null {
  if (!rows.length) return null
  const inWindow = (r: EngagementRow) => {
    if (r.effective_from > checkDate) return false
    if (r.effective_to != null && r.effective_to < checkDate) return false
    return true
  }
  const accepted = (r: EngagementRow) =>
    r.status === "accepted" || r.status === "active"
  const bestInWindow = rows.find((r) => accepted(r) && inWindow(r))
  if (bestInWindow) return { row: bestInWindow, inWindow: true }
  const bestAccepted = rows.find(accepted)
  if (bestAccepted) return { row: bestAccepted, inWindow: false }
  return { row: rows[0], inWindow: false }
}

export type GetAccountingAuthorityOpts = {
  supabase: SupabaseClient
  firmUserId: string
  businessId: string
  requiredLevel?: AccessLevel
  checkDate?: string
  /** Request-local reuse — skip a second accounting_firm_users round trip. */
  preloadedMemberships?: FirmMembershipRow[] | null
}

export async function loadFirmMemberships(
  supabase: SupabaseClient,
  userId: string
): Promise<{ rows: FirmMembershipRow[]; error: string | null; ms: number }> {
  const t = performance.now()
  const { data, error } = await supabase
    .from("accounting_firm_users")
    .select("firm_id, role")
    .eq("user_id", userId)
  return {
    rows: (data ?? []) as FirmMembershipRow[],
    error: error?.message ?? null,
    ms: timedStepMs(t),
  }
}

/**
 * Canonical firm accounting authority. Uses only accounting_firm_users + firm_client_engagements.
 * Does not query businesses or use session/resolver.
 */
export async function getAccountingAuthority(
  opts: GetAccountingAuthorityOpts
): Promise<AuthorityResult> {
  const {
    supabase,
    firmUserId,
    businessId,
    requiredLevel,
    checkDate = new Date().toISOString().split("T")[0],
    preloadedMemberships,
  } = opts
  const debug: Record<string, unknown> = {}
  const queryTimings: AuthorityQueryTimings = {
    membership_ms: 0,
    engagement_ms: 0,
    assignment_ms: 0,
  }

  const empty = (
    reason: string,
    firmId: string | null = null,
    engagementId: string | null = null,
    engagementStatus: string | null = null,
    effectiveFrom: string | null = null,
    effectiveTo: string | null = null,
    practiceRole: string | null = null
  ): AuthorityResult => ({
    allowed: false,
    level: null,
    reason,
    firmId,
    engagementId,
    engagementStatus,
    effectiveFrom,
    effectiveTo,
    practiceRole,
    debug,
    queryTimings,
  })

  let firmUsers: FirmMembershipRow[]
  let fuError: string | null = null
  if (preloadedMemberships) {
    firmUsers = preloadedMemberships
    debug.membershipReused = true
  } else {
    const loaded = await loadFirmMemberships(supabase, firmUserId)
    firmUsers = loaded.rows
    fuError = loaded.error
    queryTimings.membership_ms = loaded.ms
  }

  debug.firmUserError = fuError
  debug.firmIds = firmUsers.map((r) => r.firm_id)

  if (fuError || !firmUsers.length) {
    return empty("NO_FIRM_MEMBERSHIP")
  }

  const firmIds = firmUsers.map((r) => r.firm_id)

  const tEng = performance.now()
  const { data: engagements, error: engError } = await supabase
    .from("firm_client_engagements")
    .select("id, accounting_firm_id, client_business_id, status, access_level, effective_from, effective_to")
    .in("accounting_firm_id", firmIds)
    .eq("client_business_id", businessId)
  queryTimings.engagement_ms = timedStepMs(tEng)

  debug.engagementError = engError?.message ?? null
  debug.engagementCount = (engagements ?? []).length

  if (engError) {
    return empty("ENGAGEMENT_QUERY_ERROR")
  }

  const rows = (engagements ?? []) as EngagementRow[]
  const best = pickBestEngagement(rows, checkDate)
  if (!best) {
    const evalResult = evaluateEngagementState({ engagement: null, now: new Date(checkDate + "T12:00:00.000Z") })
    return empty(evalResult.reason_code)
  }

  const { row } = best
  const evalResult = evaluateEngagementState({
    engagement: {
      status: row.status,
      effective_from: row.effective_from,
      effective_to: row.effective_to,
    },
    now: new Date(checkDate + "T12:00:00.000Z"),
  })

  debug.pickedStatus = row.status
  debug.evaluatedState = evalResult.state
  debug.reason_code = evalResult.reason_code

  const membership = firmUsers.find((r) => r.firm_id === row.accounting_firm_id)
  const role = isPracticeFirmRole(membership?.role) ? membership.role : null

  if (evalResult.state !== "ACTIVE") {
    return empty(
      evalResult.reason_code,
      row.accounting_firm_id,
      row.id,
      row.status,
      row.effective_from,
      row.effective_to,
      role
    )
  }

  if (role) {
    // Partners are portfolio-wide; assignment/enforcement queries cannot change the decision.
    if (hasPortfolioWideVisibility(role)) {
      debug.assignment = { allowed: true, reason: "ACTIVE", skipped: "partner_portfolio" }
    } else {
      const tAsg = performance.now()
      const assignment = await assertAssignedClientAccess({
        supabase,
        userId: firmUserId,
        firmId: row.accounting_firm_id,
        businessId,
        role,
      })
      queryTimings.assignment_ms = timedStepMs(tAsg)
      debug.assignment = assignment
      if (!assignment.allowed) {
        return empty(
          assignment.reason,
          row.accounting_firm_id,
          row.id,
          row.status,
          row.effective_from,
          row.effective_to,
          role
        )
      }
    }
  }

  const level = row.access_level as AccessLevel
  if (!ACCESS_ORDER.includes(level)) {
    return empty(
      "INVALID_ACCESS_LEVEL",
      row.accounting_firm_id,
      row.id,
      row.status,
      row.effective_from,
      row.effective_to,
      role
    )
  }

  if (
    requiredLevel != null &&
    !levelSatisfies(level, requiredLevel)
  ) {
    return {
      ...empty(
        "INSUFFICIENT_ACCESS_LEVEL",
        row.accounting_firm_id,
        row.id,
        row.status,
        row.effective_from,
        row.effective_to,
        role
      ),
      level,
    }
  }

  return {
    allowed: true,
    level,
    reason: evalResult.reason_code,
    firmId: row.accounting_firm_id,
    engagementId: row.id,
    engagementStatus: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    practiceRole: role,
    debug,
    queryTimings,
  }
}

/**
 * Returns business IDs for which the firm user has effective (allowed) access today.
 * Used by effective-engagements and context-check to keep one source of truth.
 */
export async function getEffectiveBusinessIdsForFirmUser(
  supabase: SupabaseClient,
  firmUserId: string,
  checkDate?: string
): Promise<string[]> {
  const date = checkDate ?? new Date().toISOString().split("T")[0]
  return getAuthorizedClientBusinessIdsForUser(
    supabase,
    firmUserId,
    new Date(date + "T12:00:00.000Z")
  )
}
