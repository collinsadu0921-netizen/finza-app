/**
 * Short-TTL in-process cache for positive accounting readiness (reports_pnl route only).
 * Only caches ready=true. Enable: FINZA_PNL_REPORT_READINESS_CACHE_TTL_SEC=45 (default 45s).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { checkAccountingReadiness } from "@/lib/accounting/readiness"

export type PnlReadinessCacheStatus = "hit" | "miss"

type CacheEntry = { expiresAt: number }

const store = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<boolean>>()

const DEFAULT_TTL_SEC = 45

function ttlMs(): number {
  const raw = process.env.FINZA_PNL_REPORT_READINESS_CACHE_TTL_SEC
  const sec = raw === undefined || raw === "" ? DEFAULT_TTL_SEC : Number(raw)
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.min(sec, 120) * 1000
}

export function resetPnlReadinessCacheForTests(): void {
  store.clear()
  inflight.clear()
}

export async function checkAccountingReadinessForPnlRoute(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ ready: boolean; readinessCacheStatus: PnlReadinessCacheStatus }> {
  const ms = ttlMs()
  if (ms > 0) {
    const hit = store.get(businessId)
    if (hit && Date.now() < hit.expiresAt) {
      return { ready: true, readinessCacheStatus: "hit" }
    }
    if (hit) store.delete(businessId)
  }

  const pending = inflight.get(businessId)
  if (pending) {
    const ready = await pending
    return { ready, readinessCacheStatus: "miss" }
  }

  const promise = checkAccountingReadiness(supabase, businessId).then(({ ready }) => {
    if (ready && ms > 0) {
      store.set(businessId, { expiresAt: Date.now() + ms })
      if (store.size > 200) {
        const now = Date.now()
        for (const [k, v] of store) {
          if (v.expiresAt <= now) store.delete(k)
        }
      }
    }
    return ready
  })

  inflight.set(
    businessId,
    promise.finally(() => {
      inflight.delete(businessId)
    })
  )

  const ready = await promise
  return { ready, readinessCacheStatus: "miss" }
}
