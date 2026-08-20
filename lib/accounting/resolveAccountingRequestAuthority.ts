/**
 * Canonical accounting request authority for Service + Practice.
 *
 * AUTHENTICATE (caller) → explicit business → capability check → operation.
 * Does not trust browser headers or sessionStorage for authority.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  checkAccountingAuthority,
  type AccountingAuthorityAccess,
  type AccountingAuthorityResult,
} from "@/lib/accounting/auth"
import {
  getAccountingAuthority,
  type AccessLevel,
} from "@/lib/accounting/authorityEngine"
import { getUserRole } from "@/lib/userRoles"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { timedStepMs } from "@/lib/server/routeDiagnostics"

export type AuthorityTimings = {
  role_ms: number
  authority_ms: number
  total_ms: number
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

/**
 * Resolve whether the authenticated user may perform the required accounting
 * capability on an explicit client business.
 */
export async function resolveAccountingRequestAuthority(opts: {
  supabase: SupabaseClient
  userId: string
  businessId: string | null | undefined
  requiredLevel: AccountingAuthorityAccess | AccessLevel
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

  const tAll = performance.now()
  const tRole = performance.now()
  const serviceRole = await getUserRole(opts.supabase, opts.userId, businessId)
  const roleMs = timedStepMs(tRole)
  const timings = (): AuthorityTimings => ({
    role_ms: roleMs,
    authority_ms: timedStepMs(tAuthz),
    total_ms: timedStepMs(tAll),
  })

  const tAuthz = performance.now()

  // Service owner/admin/accountant: one Service gate. Do not also run the firm engine.
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
        timings: timings(),
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
      practiceRole: null,
      assignmentScoped: false,
      reason: null,
      serviceRole,
      timings: timings(),
    }
  }

  // Practice: one firm-engine call at the actual required capability.
  const firmAuth = await getAccountingAuthority({
    supabase: opts.supabase,
    firmUserId: opts.userId,
    businessId,
    requiredLevel: practiceRequired,
  })
  if (firmAuth.firmId) {
    if (!firmAuth.allowed || !firmAuth.level) {
      return {
        ok: false,
        status: 403,
        error: "Forbidden",
        reasonCode: firmAuth.reason || "INSUFFICIENT_AUTHORITY",
        businessId,
        timings: timings(),
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
      practiceRole: null,
      assignmentScoped: Boolean(firmAuth.debug?.assignment),
      reason: firmAuth.reason,
      serviceRole,
      timings: timings(),
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
      timings: timings(),
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
    practiceRole: null,
    assignmentScoped: false,
    reason: null,
    serviceRole,
    timings: timings(),
  }
}

/**
 * After application authority succeeds, Practice users often cannot satisfy
 * Service-table RLS (owner / business_users only). Use a tightly scoped
 * privileged client for those requests only.
 *
 * Callers MUST filter every query by auth.businessId.
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
