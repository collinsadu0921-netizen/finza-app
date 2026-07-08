/**
 * Cross-instance L2 cache for reports_pnl full-response payloads (Vercel Runtime Cache).
 *
 * Enable on staging preview: FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC=30
 * Default 0 = disabled. Clamped to 15–120 seconds when enabled.
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

type RuntimeCacheLike = {
  get: (key: string) => Promise<unknown>
  set: (
    key: string,
    value: unknown,
    options?: { ttl?: number; tags?: string[]; name?: string }
  ) => Promise<void>
}

let runtimeCacheOverride: RuntimeCacheLike | null = null

const REMOTE_TTL_SOFT_FRACTION = 0.8
const REMOTE_TTL_JITTER_FRACTION = 0.1

function remoteCacheBaseTtlSec(): number {
  const raw = process.env.FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC
  const sec = raw === undefined || raw === "" ? 0 : Number(raw)
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.min(Math.max(sec, 15), 120)
}

function remoteCacheTtlWithJitterSec(): number {
  const base = remoteCacheBaseTtlSec()
  if (base <= 0) return 0
  const jitter = (Math.random() * 2 - 1) * REMOTE_TTL_JITTER_FRACTION
  const raw = Math.round(base * (1 + jitter))
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.min(Math.max(raw, 15), 120)
}

function remoteCacheSoftTtlSec(hardTtlSec: number): number {
  if (!Number.isFinite(hardTtlSec) || hardTtlSec <= 0) return 0
  return Math.max(1, Math.floor(hardTtlSec * REMOTE_TTL_SOFT_FRACTION))
}

export function isPnlReportRemoteCacheEnabled(): boolean {
  return remoteCacheBaseTtlSec() > 0
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
): Promise<{ status: PnlReportRemoteCacheStatus; entry?: PnlReportRemoteCacheEntry<T> }> {
  if (!isPnlReportRemoteCacheEnabled()) {
    return { status: "miss" }
  }

  try {
    const cached = await getRuntimeCache().get(key)
    if (cached === undefined || cached === null) {
      return { status: "miss" }
    }
    if (!isValidRemoteEntry<T>(cached)) {
      return { status: "miss" }
    }

    const ageMs = Date.now() - new Date(cached.cachedAt).getTime()
    // If cachedAt parsing fails, treat as miss.
    if (!Number.isFinite(ageMs) || ageMs < 0) {
      return { status: "miss" }
    }

    const ageSec = ageMs / 1000
    const hardTtlSec = cached.hardTtlSec
    const softTtlSec = cached.softTtlSec

    if (ageSec <= softTtlSec) {
      return {
        status: "hit",
        entry: {
          payload: structuredClone(cached.payload),
          loadMeta: { ...cached.loadMeta },
          cachedAt: cached.cachedAt,
          hardTtlSec,
          softTtlSec,
        },
      }
    }

    if (ageSec <= hardTtlSec) {
      return {
        status: "stale_hit",
        entry: {
          payload: structuredClone(cached.payload),
          loadMeta: { ...cached.loadMeta },
          cachedAt: cached.cachedAt,
          hardTtlSec,
          softTtlSec,
        },
      }
    }

    return { status: "miss" }
  } catch (err) {
    console.warn(
      "[pnl-report-remote-cache] get failed:",
      err instanceof Error ? err.message : String(err)
    )
    return { status: "error" }
  }
}

export async function setPnlReportRemoteCacheEntry<T>(
  key: string,
  entry: PnlReportRemoteCacheValue<T>,
  options?: { businessId?: string }
): Promise<"stored" | "skipped" | "error"> {
  const hardTtlSec = remoteCacheTtlWithJitterSec()
  if (hardTtlSec <= 0) return "skipped"
  // Only validate the payload + loadMeta (we stamp ttl fields below).
  if (!shouldCachePnlReportPayload(entry.payload)) return "skipped"
  if (entry.loadMeta.movementSource === "unavailable") return "skipped"

  try {
    const tags = ["reports_pnl"]
    const businessTagValue = businessTag(options?.businessId)
    if (businessTagValue) tags.push(businessTagValue)

    const softTtlSec = remoteCacheSoftTtlSec(hardTtlSec)
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
