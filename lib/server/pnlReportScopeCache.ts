/**
 * Short-TTL in-process cache for positive P&L route scope + read authority (reports_pnl only).
 * Caches successful scope resolution and read authority together — skips repeated
 * getUserRole / businesses / authority DB on warm instances.
 *
 * Enable: FINZA_PNL_REPORT_SCOPE_CACHE_TTL_SEC=45 (default 45s; 0 disables).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  checkAccountingAuthority,
  type AccountingAuthorityResult,
} from "@/lib/accounting/auth"
import { resolveBusinessScopeForUser, type ResolveBusinessScopeResult } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"

export type PnlScopeCacheStatus = "hit" | "miss" | "disabled"

export type PnlReportScopeAuthorityOk = {
  businessId: string
  role: string
  authority: AccountingAuthorityResult & {
    authorized: true
    authority_source: NonNullable<AccountingAuthorityResult["authority_source"]>
  }
}

type CacheEntry = {
  expiresAt: number
  businessId: string
  role: string
  authority_source: NonNullable<AccountingAuthorityResult["authority_source"]>
}

export type ResolvePnlReportScopeAuthorityResult =
  | { ok: true; value: PnlReportScopeAuthorityOk; pnlScopeCacheStatus: PnlScopeCacheStatus }
  | {
      ok: false
      scope: Extract<ResolveBusinessScopeResult, { ok: false }>
      pnlScopeCacheStatus: PnlScopeCacheStatus
    }
  | {
      ok: false
      scope: Extract<ResolveBusinessScopeResult, { ok: true }>
      authority: AccountingAuthorityResult
      pnlScopeCacheStatus: PnlScopeCacheStatus
    }

const store = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<ResolvePnlReportScopeAuthorityResult>>()

const DEFAULT_TTL_SEC = 45

function ttlMs(): number {
  const raw = process.env.FINZA_PNL_REPORT_SCOPE_CACHE_TTL_SEC
  const sec = raw === undefined || raw === "" ? DEFAULT_TTL_SEC : Number(raw)
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.min(sec, 120) * 1000
}

function cacheKey(userId: string, requestedBusinessId: string): string {
  return `${userId}:${requestedBusinessId.trim()}`
}

export function resetPnlScopeCacheForTests(): void {
  store.clear()
  inflight.clear()
}

function entryToResult(
  entry: CacheEntry,
  pnlScopeCacheStatus: PnlScopeCacheStatus
): Extract<ResolvePnlReportScopeAuthorityResult, { ok: true }> {
  return {
    ok: true,
    pnlScopeCacheStatus,
    value: {
      businessId: entry.businessId,
      role: entry.role,
      authority: {
        authorized: true,
        businessId: entry.businessId,
        authority_source: entry.authority_source,
      },
    },
  }
}

function cachePositiveExplicitResult(
  userId: string,
  explicitBusinessId: string,
  value: PnlReportScopeAuthorityOk,
  ms: number
): void {
  if (ms <= 0 || explicitBusinessId !== value.businessId) return
  const key = cacheKey(userId, explicitBusinessId)
  store.set(key, {
    expiresAt: Date.now() + ms,
    businessId: value.businessId,
    role: value.role,
    authority_source: value.authority.authority_source,
  })
  if (store.size > 500) {
    const now = Date.now()
    for (const [k, v] of store) {
      if (v.expiresAt <= now) store.delete(k)
    }
  }
}

async function loadScopeAndAuthority(
  supabase: SupabaseClient,
  userId: string,
  requestedBusinessId: string | null | undefined
): Promise<ResolvePnlReportScopeAuthorityResult> {
  const trimmed =
    typeof requestedBusinessId === "string" ? requestedBusinessId.trim() : ""
  const explicitBusinessId = trimmed.length > 0 ? trimmed : null

  let knownRole: string | null | undefined = undefined
  if (explicitBusinessId) {
    knownRole = await getUserRole(supabase, userId, explicitBusinessId)
  }

  const scope = await resolveBusinessScopeForUser(supabase, userId, requestedBusinessId, {
    knownRole,
  })

  if (!scope.ok) {
    return { ok: false, scope, pnlScopeCacheStatus: "miss" }
  }

  const authority = await checkAccountingAuthority(
    supabase,
    userId,
    scope.businessId,
    "read",
    knownRole
  )

  if (!authority.authorized || !authority.authority_source) {
    return { ok: false, scope, authority, pnlScopeCacheStatus: "miss" }
  }

  const role =
    knownRole !== undefined && knownRole !== null
      ? knownRole
      : await getUserRole(supabase, userId, scope.businessId)

  if (!role) {
    return { ok: false, scope, authority, pnlScopeCacheStatus: "miss" }
  }

  return {
    ok: true,
    value: {
      businessId: scope.businessId,
      role,
      authority: {
        authorized: true,
        businessId: scope.businessId,
        authority_source: authority.authority_source,
      },
    },
    pnlScopeCacheStatus: "miss",
  }
}

export async function resolvePnlReportScopeAndAuthority(
  supabase: SupabaseClient,
  userId: string,
  requestedBusinessId: string | null | undefined
): Promise<ResolvePnlReportScopeAuthorityResult> {
  const trimmed =
    typeof requestedBusinessId === "string" ? requestedBusinessId.trim() : ""
  const explicitBusinessId = trimmed.length > 0 ? trimmed : null
  const ms = ttlMs()
  const pnlScopeCacheStatus: PnlScopeCacheStatus = ms > 0 ? "miss" : "disabled"

  if (explicitBusinessId && ms > 0) {
    const key = cacheKey(userId, explicitBusinessId)
    const hit = store.get(key)
    if (hit && Date.now() < hit.expiresAt && hit.businessId === explicitBusinessId) {
      return entryToResult(hit, "hit")
    }
    if (hit) store.delete(key)

    const pending = inflight.get(key)
    if (pending) {
      return pending
    }

    const promise = loadScopeAndAuthority(supabase, userId, requestedBusinessId).then(
      (result) => {
        if (result.ok) {
          cachePositiveExplicitResult(userId, explicitBusinessId, result.value, ms)
          return { ...result, pnlScopeCacheStatus: "miss" as const }
        }
        return { ...result, pnlScopeCacheStatus: "miss" as const }
      }
    )

    inflight.set(
      key,
      promise.finally(() => {
        inflight.delete(key)
      })
    )

    return promise
  }

  const result = await loadScopeAndAuthority(supabase, userId, requestedBusinessId)
  return { ...result, pnlScopeCacheStatus }
}
