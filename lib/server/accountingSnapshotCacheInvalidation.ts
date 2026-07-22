/**
 * Best-effort cache invalidation after snapshot refresh (539).
 * Prefer generation/tag busting over broad global clears.
 */

import { getCache } from "@vercel/functions"

import { invalidateDashboardMetricsCachePrefix } from "@/lib/server/dashboardMetricsCache"
import { invalidatePnlReportCacheForBusiness } from "@/lib/server/pnlReportCache"

export async function invalidatePnlReportCachesForBusiness(businessId: string): Promise<void> {
  invalidatePnlReportCacheForBusiness(businessId)

  try {
    const cache = getCache({ namespace: "reports-pnl" }) as {
      expireTag?: (tag: string | string[]) => Promise<void>
    }
    if (typeof cache.expireTag === "function") {
      await cache.expireTag([`business:${businessId}`, "reports_pnl"])
    }
  } catch (err) {
    console.warn(
      "[accounting-snapshot-cache] remote expireTag failed:",
      err instanceof Error ? err.message : String(err)
    )
  }
}

export function invalidateDashboardMetricsCacheForBusiness(businessId: string): void {
  invalidateDashboardMetricsCachePrefix(businessId)
}
