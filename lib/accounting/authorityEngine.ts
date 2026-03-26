/**
 * Canonical Accounting Authority Engine (firm-user path only).
 * Single source of truth for firm + engagement authority. No businesses table, no session.
 * Engagement state is determined solely by evaluateEngagementState (Wave 15).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { evaluateEngagementState } from "@/lib/accounting/evaluateEngagementState"

export type AccessLevel = "read" | "write" | "approve"

export type AuthorityResult = {
  allowed: boolean
  level: AccessLevel | null
  reason: string
  firmId: string | null
  engagementId: string | null
  engagementStatus: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
  debug: Record<string, unknown>
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
  } = opts
  const debug: Record<string, unknown> = {}

  const empty = (
    reason: string,
    firmId: string | null = null,
    engagementId: string | null = null,
    engagementStatus: string | null = null,
    effectiveFrom: string | null = null,
    effectiveTo: string | null = null
  ): AuthorityResult => ({
    allowed: false,
    level: null,
    reason,
    firmId,
    engagementId,
    engagementStatus,
    effectiveFrom,
    effectiveTo,
    debug,
  })

  const { data: firmUsers, error: fuError } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", firmUserId)

  debug.firmUserError = fuError?.message ?? null
  debug.firmIds = (firmUsers ?? []).map((r: { firm_id: string }) => r.firm_id)

  if (fuError || !firmUsers?.length) {
    return empty("NO_FIRM_MEMBERSHIP")
  }

  const firmIds = firmUsers.map((r: { firm_id: string }) => r.firm_id)

  const { data: engagements, error: engError } = await supabase
    .from("firm_client_engagements")
    .select("id, accounting_firm_id, client_business_id, status, access_level, effective_from, effective_to")
    .in("accounting_firm_id", firmIds)
    .eq("client_business_id", businessId)

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

  if (evalResult.state !== "ACTIVE") {
    return empty(
      evalResult.reason_code,
      row.accounting_firm_id,
      row.id,
      row.status,
      row.effective_from,
      row.effective_to
    )
  }

  const level = row.access_level as AccessLevel
  if (!ACCESS_ORDER.includes(level)) {
    return empty(
      "INVALID_ACCESS_LEVEL",
      row.accounting_firm_id,
      row.id,
      row.status,
      row.effective_from,
      row.effective_to
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
        row.effective_to
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
    debug,
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
  const { data: firmUsers, error: fuError } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", firmUserId)
  if (fuError || !firmUsers?.length) return []
  const firmIds = firmUsers.map((r: { firm_id: string }) => r.firm_id)
  const { data: engagements } = await supabase
    .from("firm_client_engagements")
    .select("client_business_id")
    .in("accounting_firm_id", firmIds)
  const candidateIds = [...new Set((engagements ?? []).map((e: { client_business_id: string }) => e.client_business_id))]
  const effective: string[] = []
  for (const bid of candidateIds) {
    const result = await getAccountingAuthority({
      supabase,
      firmUserId,
      businessId: bid,
      checkDate: date,
    })
    if (result.allowed) effective.push(bid)
  }
  return effective
}
