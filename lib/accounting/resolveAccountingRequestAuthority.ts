/**
 * Canonical accounting request authority for Service + Practice.
 *
 * AUTHENTICATE (caller) → explicit business → capability check → operation.
 * Does not trust browser headers or sessionStorage for authority.
 *
 * `authorityContext` may only choose lookup order. It never grants access.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  checkAccountingAuthority,
  type AccountingAuthorityAccess,
  type AccountingAuthorityResult,
} from "@/lib/accounting/auth"
import {
  getAccountingAuthority,
  loadFirmMemberships,
  type AccessLevel,
  type AuthorityQueryTimings,
  type FirmMembershipRow,
} from "@/lib/accounting/authorityEngine"
import { getUserRole } from "@/lib/userRoles"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { timedStepMs } from "@/lib/server/routeDiagnostics"

export type AuthorityLookupContext = "practice-client-books"

export type AuthorityTimings = {
  role_ms: number
  authority_ms: number
  membership_ms: number
  engagement_ms: number
  assignment_ms: number
  total_ms: number
  strategy: "service-first" | "parallel"
}

export type AccountingAuthoritySource =
  | NonNullable<AccountingAuthorityResult["authority_source"]>
  | "practice"

export type AccountingRequestAuthorityOk = {
  ok: true
  userId: string
  businessId: string
  requiredLevel: AccountingAuthorityAccess | AccessLevel
  grantedLevel: AccessLevel | "owner" | "employee" | "accountant" | "report_viewer" | null
  authoritySource: AccountingAuthoritySource
  /** True when authority came from firm engagement (not owner/business_users). */
  isPractice: boolean
  firmId: string | null
  engagementId: string | null
  engagementStatus: string | null
  practiceRole: string | null
  assignmentScoped: boolean
  reason: string | null
  /** Service role from business_users/owner, if any. */
  serviceRole: string | null
  timings: AuthorityTimings
}

export type AccountingRequestAuthorityDenied = {
  ok: false
  status: 400 | 401 | 403 | 404
  error: string
  reasonCode: string
  businessId: string | null
  timings?: AuthorityTimings
}

export type AccountingRequestAuthority = AccountingRequestAuthorityOk | AccountingRequestAuthorityDenied

export function deniedMutationResponse(
  auth: AccountingRequestAuthorityDenied,
  requiredLevel: "write" | "approve",
  action: string
): { status: number; body: { error: string; reason_code: string } } {
  const error =
    auth.reasonCode === "INSUFFICIENT_ACCESS_LEVEL"
      ? requiredLevel === "approve"
        ? `Approve access is required to ${action}.`
        : `Write access is required to ${action}.`
      : auth.error
  return { status: auth.status, body: { error, reason_code: auth.reasonCode } }
}

function emptyQueryTimings(): AuthorityQueryTimings {
  return { membership_ms: 0, engagement_ms: 0, assignment_ms: 0 }
}

/**
 * Resolve whether the authenticated user may perform the required accounting
 * capability on an explicit client business.
 */
export async function resolveAccountingRequestAuthority(opts: {
  supabase: SupabaseClient
  userId: string
  businessId: string | null | undefined
  requiredLevel: AccountingAuthorityAccess | AccessLevel
  /**
   * Lookup strategy only. Never trusted as authorization.
   * `practice-client-books` overlaps Service role + firm membership reads.
   */
  authorityContext?: AuthorityLookupContext
}): Promise<AccountingRequestAuthority> {
  const businessId = (opts.businessId ?? "").trim()
  if (!businessId) {
    return {
      ok: false,
      status: 400,
      error: "business_id is required",
      reasonCode: "MISSING_BUSINESS_ID",
      businessId: null,
    }
  }

  const required =
    opts.requiredLevel === "approve" ? "write" : (opts.requiredLevel as AccountingAuthorityAccess)
  const practiceRequired: AccessLevel =
    opts.requiredLevel === "approve"
      ? "approve"
      : opts.requiredLevel === "write"
        ? "write"
        : "read"

  const parallel = opts.authorityContext === "practice-client-books"
  const tAll = performance.now()
  const tRole = performance.now()

  let serviceRole: string | null
  let preloadedMemberships: FirmMembershipRow[] | null = null
  let membershipMs = 0

  if (parallel) {
    const [role, membership] = await Promise.all([
      getUserRole(opts.supabase, opts.userId, businessId),
      loadFirmMemberships(opts.supabase, opts.userId),
    ])
    serviceRole = role
    preloadedMemberships = membership.rows
    membershipMs = membership.ms
  } else {
    serviceRole = await getUserRole(opts.supabase, opts.userId, businessId)
  }

  const roleMs = timedStepMs(tRole)
  const tAuthz = performance.now()
  let queryTimings = emptyQueryTimings()
  queryTimings.membership_ms = membershipMs

  const timings = (strategy: AuthorityTimings["strategy"]): AuthorityTimings => ({
    role_ms: roleMs,
    authority_ms: timedStepMs(tAuthz),
    membership_ms: queryTimings.membership_ms,
    engagement_ms: queryTimings.engagement_ms,
    assignment_ms: queryTimings.assignment_ms,
    total_ms: timedStepMs(tAll),
    strategy,
  })

  // Service owner/admin/accountant: Service gate wins. Hint never overrides this.
  if (serviceRole === "owner" || serviceRole === "admin" || serviceRole === "accountant") {
    const base = await checkAccountingAuthority(
      opts.supabase,
      opts.userId,
      businessId,
      required,
      serviceRole
    )
    if (!base.authorized || !base.authority_source) {
      return {
        ok: false,
        status: 403,
        error: "Forbidden",
        reasonCode: "INSUFFICIENT_AUTHORITY",
        businessId,
        timings: timings(parallel ? "parallel" : "service-first"),
      }
    }
    return {
      ok: true,
      userId: opts.userId,
      businessId,
      requiredLevel: opts.requiredLevel,
      grantedLevel: base.authority_source === "owner" ? "owner" : "employee",
      authoritySource: base.authority_source,
      isPractice: false,
      firmId: null,
      engagementId: null,
      engagementStatus: null,
      practiceRole: null,
      assignmentScoped: false,
      reason: null,
      serviceRole,
      timings: timings(parallel ? "parallel" : "service-first"),
    }
  }

  const skipFirmEngine = parallel && preloadedMemberships !== null && preloadedMemberships.length === 0
  if (!skipFirmEngine) {
    const firmAuth = await getAccountingAuthority({
      supabase: opts.supabase,
      firmUserId: opts.userId,
      businessId,
      requiredLevel: practiceRequired,
      preloadedMemberships,
    })
    queryTimings = {
      membership_ms: membershipMs || firmAuth.queryTimings.membership_ms,
      engagement_ms: firmAuth.queryTimings.engagement_ms,
      assignment_ms: firmAuth.queryTimings.assignment_ms,
    }
    if (firmAuth.firmId) {
      if (!firmAuth.allowed || !firmAuth.level) {
        return {
          ok: false,
          status: 403,
          error: "Forbidden",
          reasonCode: firmAuth.reason || "INSUFFICIENT_AUTHORITY",
          businessId,
          timings: timings(parallel ? "parallel" : "service-first"),
        }
      }
      return {
        ok: true,
        userId: opts.userId,
        businessId,
        requiredLevel: opts.requiredLevel,
        grantedLevel: firmAuth.level,
        authoritySource: "practice",
        isPractice: true,
        firmId: firmAuth.firmId,
        engagementId: firmAuth.engagementId,
        engagementStatus: firmAuth.engagementStatus,
        practiceRole: firmAuth.practiceRole,
        assignmentScoped: Boolean(firmAuth.debug?.assignment),
        reason: firmAuth.reason,
        serviceRole,
        timings: timings(parallel ? "parallel" : "service-first"),
      }
    }
  }

  // Remaining Service-adjacent roles (e.g. report_viewer) or no access.
  const base = await checkAccountingAuthority(
    opts.supabase,
    opts.userId,
    businessId,
    required,
    serviceRole
  )
  if (!base.authorized || !base.authority_source) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden",
      reasonCode: "INSUFFICIENT_AUTHORITY",
      businessId,
      timings: timings(parallel ? "parallel" : "service-first"),
    }
  }
  return {
    ok: true,
    userId: opts.userId,
    businessId,
    requiredLevel: opts.requiredLevel,
    grantedLevel:
      base.authority_source === "report_viewer" ? "report_viewer" : "employee",
    authoritySource: base.authority_source,
    isPractice: false,
    firmId: null,
    engagementId: null,
    engagementStatus: null,
    practiceRole: null,
    assignmentScoped: false,
    reason: null,
    serviceRole,
    timings: timings(parallel ? "parallel" : "service-first"),
  }
}

/**
 * After application authority succeeds, Practice users often cannot satisfy
 * Service-table RLS (owner / business_users only). Use a tightly scoped
 * privileged client for those requests only.
 *
 * Callers MUST filter every query by auth.businessId.
 *
 * Do NOT use this client for SECURITY DEFINER RPCs that authorize via
 * auth.uid() (get_balance_sheet_as_of, get_cumulative_net_income_as_of,
 * finza_dashboard_positions_as_of). Use getAccountingIdentityClient.
 */
export function getAccountingDataClient(
  auth: AccountingRequestAuthorityOk,
  userScoped: SupabaseClient
): SupabaseClient {
  if (auth.isPractice) {
    return createSupabaseAdminClient()
  }
  return userScoped
}

/**
 * Session client for RPCs that independently authorize from persisted
 * auth.uid(). Always the requesting user's JWT — never service_role.
 *
 * Practice table reads may still use getAccountingDataClient; 577 (and 576)
 * DEFINER functions must not.
 */
export function getAccountingIdentityClient(
  _auth: AccountingRequestAuthorityOk,
  userScoped: SupabaseClient
): SupabaseClient {
  return userScoped
}
