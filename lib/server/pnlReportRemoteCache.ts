/**
 * Cross-instance L2 cache for reports_pnl full-response payloads (Vercel Runtime Cache).
 *
 * Enable on staging preview: FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC=30
 * Default 0 = disabled. Clamped to 15–120 seconds when enabled.
 */

import { getCache } from "@vercel/functions"

import type { PnLReportLoadMeta } from "@/lib/accounting/reports/getProfitAndLossReport"
import { shouldCachePnlReportPayload } from "@/lib/server/pnlReportCache"

export type PnlReportRemoteCacheStatus = "disabled" | "hit" | "miss" | "error"

export type PnlReportRemoteCacheEntry<T> = {
  payload: T
  loadMeta: PnLReportLoadMeta
  cachedAt: string
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

function remoteCacheTtlSec(): number {
  const raw = process.env.FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC
  const sec = raw === undefined || raw === "" ? 0 : Number(raw)
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.min(Math.max(sec, 15), 120)
}

export function isPnlReportRemoteCacheEnabled(): boolean {
  return remoteCacheTtlSec() > 0
}

function getRuntimeCache(): RuntimeCacheLike {
  if (runtimeCacheOverride) return runtimeCacheOverride
  return getCache({ namespace: "reports-pnl" })
}

function isValidRemoteEntry<T>(value: unknown): value is PnlReportRemoteCacheEntry<T> {
  if (value == null || typeof value !== "object") return false
  const entry = value as Partial<PnlReportRemoteCacheEntry<T>>
  if (!entry.loadMeta || typeof entry.loadMeta !== "object") return false
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
    return { status: "disabled" }
  }

  try {
    const cached = await getRuntimeCache().get(key)
    if (cached === undefined || cached === null) {
      return { status: "miss" }
    }
    if (!isValidRemoteEntry<T>(cached)) {
      return { status: "miss" }
    }
    return {
      status: "hit",
      entry: {
        payload: structuredClone(cached.payload),
        loadMeta: { ...cached.loadMeta },
        cachedAt: cached.cachedAt,
      },
    }
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
  entry: PnlReportRemoteCacheEntry<T>,
  options?: { businessId?: string }
): Promise<"stored" | "skipped" | "error"> {
  const ttlSec = remoteCacheTtlSec()
  if (ttlSec <= 0) return "skipped"
  if (!isValidRemoteEntry<T>(entry)) return "skipped"

  try {
    const tags = ["reports_pnl"]
    const businessTagValue = businessTag(options?.businessId)
    if (businessTagValue) tags.push(businessTagValue)

    await getRuntimeCache().set(key, entry, {
      ttl: ttlSec,
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
