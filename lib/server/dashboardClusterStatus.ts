/**
 * Dashboard cluster readiness / status for service-cluster API + client.
 */

export type DashboardClusterStatus = "fresh" | "stale" | "preparing" | "degraded"

export type DashboardClusterCacheSourceForStatus =
  | "fresh_hit"
  | "stale_hit"
  | "miss"
  | "refresh_started"
  | "refresh_skipped"
  | "preparing"
  | "degraded"

export type DashboardStatusPayloadHints = {
  dashboard_status?: DashboardClusterStatus
  dashboard_ready?: boolean
  timelineSource?: string
  timeline?: unknown[]
  metrics?: {
    period?: { resolution_reason?: string }
    metrics_ready?: boolean
    snapshot_status?: string
  } | null
}

export function resolveDashboardClusterStatus(
  cacheSource: DashboardClusterCacheSourceForStatus,
  payload: DashboardStatusPayloadHints
): DashboardClusterStatus {
  if (payload.dashboard_status === "preparing" || payload.dashboard_ready === false) {
    return "preparing"
  }
  if (payload.timelineSource === "preparing") {
    return "preparing"
  }
  if (payload.metrics?.period?.resolution_reason === "preparing") {
    return "preparing"
  }
  if (payload.metrics?.metrics_ready === false) {
    if ((payload.timeline?.length ?? 0) > 0) {
      return "degraded"
    }
    return "preparing"
  }
  if (
    payload.metrics?.snapshot_status === "live_fallback" ||
    payload.metrics?.snapshot_status === "stale"
  ) {
    return "stale"
  }

  switch (cacheSource) {
    case "fresh_hit":
    case "miss":
      return "fresh"
    case "stale_hit":
    case "refresh_started":
    case "refresh_skipped":
      return "stale"
    case "preparing":
      return "preparing"
    case "degraded":
      if ((payload.timeline?.length ?? 0) > 0) {
        return "degraded"
      }
      if (payload.timelineSource === "degraded") {
        return "preparing"
      }
      return "degraded"
    default:
      return "fresh"
  }
}

export function isDashboardClusterReady(status: DashboardClusterStatus): boolean {
  return status !== "preparing"
}
