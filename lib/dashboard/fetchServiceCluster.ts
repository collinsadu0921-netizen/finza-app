import { SERVICE_LIST_REMOUNT_TTL_MS, sharedJsonGet } from "@/lib/client/sharedJsonGet"

export type ServiceClusterFetchOptions = {
  periodStart?: string | null
  previousPeriodStart?: string | null
  fresh?: boolean
}

export function buildServiceClusterUrl(
  businessId: string,
  options: Pick<ServiceClusterFetchOptions, "periodStart" | "previousPeriodStart"> = {}
): string {
  const params = new URLSearchParams({
    business_id: businessId,
    periods: "12",
    activity_limit: "10",
  })
  if (options.periodStart) {
    params.set("period_start", options.periodStart)
    if (options.previousPeriodStart) {
      params.set("previous_period_start", options.previousPeriodStart)
    }
  }
  return `/api/dashboard/service-cluster?${params.toString()}`
}

export function serviceClusterCacheKey(url: string, businessId: string): string {
  return `${url}::${businessId}`
}

export async function fetchServiceClusterJson<T = unknown>(
  businessId: string,
  options: ServiceClusterFetchOptions = {}
): Promise<{ ok: boolean; status: number; json: T }> {
  const url = buildServiceClusterUrl(businessId, options)
  return sharedJsonGet<T>(url, {
    ttlMs: SERVICE_LIST_REMOUNT_TTL_MS,
    fresh: options.fresh,
    cacheKey: serviceClusterCacheKey(url, businessId),
  })
}
