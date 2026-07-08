/**
 * Cross-instance L2 cache for reports_pnl full-response payloads (Vercel Runtime Cache).
 *
 * Enable on staging preview:
 *   FINZA_PNL_REPORT_REMOTE_CACHE_HARD_TTL_SEC=900
 *   FINZA_PNL_REPORT_REMOTE_CACHE_SOFT_TTL_SEC=30
 *
 * Legacy enable flag (uses default 15m hard window when HARD is unset):
 *   FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC=1
 *
 * Default off when neither HARD nor legacy enable is set.
 */

import { getCache } from "@vercel/functions"

import type { PnLReportLoadMeta } from "@/lib/accounting/reports/getProfitAndLossReport"
import { shouldCachePnlReportPayload } from "@/lib/server/pnlReportCache"

export type PnlReportRemoteCacheStatus = "hit" | "stale_hit" | "miss" | "error"

export type PnlReportRemoteCacheEntry<T> = {
  payload: T
  loadMeta: PnLReportLoadMeta
  cachedAt: string
  hardTtlSec: number
  softTtlSec: number
}

export type PnlReportRemoteCacheValue<T> = {
  payload: T
  loadMeta: PnLReportLoadMeta
}

export type PnlReportRemoteCacheGetResult<T> = {
  status: PnlReportRemoteCacheStatus
  entry?: PnlReportRemoteCacheEntry<T>
  readMs: number
}

type RuntimeCacheLike = {
  get: (key: string) => Promise<unknown>
  set: (
    key: string,
    value: unknown,
    options?: { ttl?: number; tags?: string[]; name?: string }
  ) => Promise<void>
}

let runtimeCacheOverride: RuntimeCacheLike | null = null

const REMOTE_TTL_JITTER_FRACTION = 0.1
const REMOTE_HARD_TTL_MIN_SEC = 600
const REMOTE_HARD_TTL_MAX_SEC = 900
const REMOTE_SOFT_TTL_DEFAULT_SEC = 30
const REMOTE_LEGACY_ENABLE_DEFAULT_HARD_SEC = 900

function parsePositiveEnvSec(name: string): number {
  const raw = process.env[name]
  const sec = raw === undefined || raw === "" ? 0 : Number(raw)
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return sec
}

/** Base hard TTL before jitter (0 = disabled). */
export function remoteCacheHardTtlBaseSec(): number {
  const hard = parsePositiveEnvSec("FINZA_PNL_REPORT_REMOTE_CACHE_HARD_TTL_SEC")
  if (hard > 0) {
    return Math.min(Math.max(hard, REMOTE_HARD_TTL_MIN_SEC), REMOTE_HARD_TTL_MAX_SEC)
  }
  const legacy = parsePositiveEnvSec("FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC")
  if (legacy > 0) {
    return REMOTE_LEGACY_ENABLE_DEFAULT_HARD_SEC
  }
  return 0
}

export function remoteCacheSoftTtlSec(): number {
  const raw = process.env.FINZA_PNL_REPORT_REMOTE_CACHE_SOFT_TTL_SEC
  const sec = raw === undefined || raw === "" ? REMOTE_SOFT_TTL_DEFAULT_SEC : Number(raw)
  if (!Number.isFinite(sec) || sec <= 0) return REMOTE_SOFT_TTL_DEFAULT_SEC
  return Math.min(Math.max(sec, 15), 120)
}

function remoteCacheHardTtlSecWithJitter(): number {
  const base = remoteCacheHardTtlBaseSec()
  if (base <= 0) return 0
  const jitter = Math.random() * REMOTE_TTL_JITTER_FRACTION
  return Math.round(base * (1 + jitter))
}

export function isPnlReportRemoteCacheEnabled(): boolean {
  return remoteCacheHardTtlBaseSec() > 0
}

function getRuntimeCache(): RuntimeCacheLike {
  if (runtimeCacheOverride) return runtimeCacheOverride
  return getCache({ namespace: "reports-pnl" })
}

function isValidRemoteEntry<T>(value: unknown): value is PnlReportRemoteCacheEntry<T> {
  if (value == null || typeof value !== "object") return false
  const entry = value as Partial<PnlReportRemoteCacheEntry<T>>
  if (!entry.loadMeta || typeof entry.loadMeta !== "object") return false
  if (!entry.cachedAt || typeof entry.cachedAt !== "string") return false
  if (!Number.isFinite(entry.hardTtlSec) || !Number.isFinite(entry.softTtlSec)) return false
  if ((entry.hardTtlSec as number) <= 0 || (entry.softTtlSec as number) <= 0) return false
  if ((entry.softTtlSec as number) > (entry.hardTtlSec as number)) return false
  if (!shouldCachePnlReportPayload(entry.payload)) return false
  if (entry.loadMeta.movementSource === "unavailable") return false
  return true
}

function businessTag(businessId: string | undefined): string | null {
  if (!businessId) return null
  const trimmed = businessId.trim()
  if (!trimmed) return null
  return `business:${trimmed}`
}

export async function getPnlReportRemoteCacheEntry<T>(
  key: string
): Promise<PnlReportRemoteCacheGetResult<T>> {
  const t0 = performance.now()
  if (!isPnlReportRemoteCacheEnabled()) {
    return { status: "miss", readMs: 0 }
  }

  try {
    const cached = await getRuntimeCache().get(key)
    const readMs = Math.round((performance.now() - t0) * 10) / 10

    if (cached === undefined || cached === null) {
      return { status: "miss", readMs }
    }
    if (!isValidRemoteEntry<T>(cached)) {
      return { status: "miss", readMs }
    }

    const ageMs = Date.now() - new Date(cached.cachedAt).getTime()
    if (!Number.isFinite(ageMs) || ageMs < 0) {
      return { status: "miss", readMs }
    }

    const ageSec = ageMs / 1000
    const hardTtlSec = cached.hardTtlSec
    const softTtlSec = cached.softTtlSec

    const entry: PnlReportRemoteCacheEntry<T> = {
      payload: structuredClone(cached.payload),
      loadMeta: { ...cached.loadMeta },
      cachedAt: cached.cachedAt,
      hardTtlSec,
      softTtlSec,
    }

    if (ageSec <= softTtlSec) {
      return { status: "hit", entry, readMs }
    }

    if (ageSec <= hardTtlSec) {
      return { status: "stale_hit", entry, readMs }
    }

    return { status: "miss", readMs }
  } catch (err) {
    console.warn(
      "[pnl-report-remote-cache] get failed:",
      err instanceof Error ? err.message : String(err)
    )
    return {
      status: "error",
      readMs: Math.round((performance.now() - t0) * 10) / 10,
    }
  }
}

export async function setPnlReportRemoteCacheEntry<T>(
  key: string,
  entry: PnlReportRemoteCacheValue<T>,
  options?: { businessId?: string }
): Promise<"stored" | "skipped" | "error"> {
  const hardTtlSec = remoteCacheHardTtlSecWithJitter()
  if (hardTtlSec <= 0) return "skipped"
  if (!shouldCachePnlReportPayload(entry.payload)) return "skipped"
  if (entry.loadMeta.movementSource === "unavailable") return "skipped"

  const softTtlSec = remoteCacheSoftTtlSec()
  if (softTtlSec >= hardTtlSec) return "skipped"

  try {
    const tags = ["reports_pnl"]
    const businessTagValue = businessTag(options?.businessId)
    if (businessTagValue) tags.push(businessTagValue)

    const storedEntry: PnlReportRemoteCacheEntry<T> = {
      payload: entry.payload,
      loadMeta: entry.loadMeta,
      cachedAt: new Date().toISOString(),
      hardTtlSec,
      softTtlSec,
    }

    await getRuntimeCache().set(key, storedEntry, {
      ttl: hardTtlSec,
      tags,
      name: "reports-pnl-response",
    })
    return "stored"
  } catch (err) {
    console.warn(
      "[pnl-report-remote-cache] set failed:",
      err instanceof Error ? err.message : String(err)
    )
    return "error"
  }
}

/** Test-only: inject mock Runtime Cache implementation. */
export function setPnlReportRemoteCacheForTests(cache: RuntimeCacheLike | null): void {
  runtimeCacheOverride = cache
}

/** Test-only: clear mock Runtime Cache implementation. */
export function resetPnlReportRemoteCacheForTests(): void {
  runtimeCacheOverride = null
}
