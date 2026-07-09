/**
 * Dashboard cluster request-path refresh policy (operational load gate).
 *
 * Default OFF: cluster reads summary/cache only — no blocking refresh or live
 * metrics RPC in the request path. Enable with FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST=1
 * for controlled validation or manual priming workflows.
 */

export type DashboardRefreshOnRequestDiag = "enabled" | "disabled"

export type DashboardClusterSource = "cache" | "summary" | "live" | "degraded"

export function isDashboardClusterRefreshOnRequestEnabled(): boolean {
  const raw = String(process.env.FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST ?? "").trim()
  return raw === "1" || raw.toLowerCase() === "true"
}

export function dashboardRefreshOnRequestDiag(): DashboardRefreshOnRequestDiag {
  return isDashboardClusterRefreshOnRequestEnabled() ? "enabled" : "disabled"
}

export function dashboardRefreshSkipped(refreshOnRequest: boolean): boolean {
  return !refreshOnRequest
}

export function resolveDashboardClusterSource(input: {
  cacheSource: "cache_hit" | "cache_miss" | "cache_coalesce"
  timelineSource: string
  metricsSource: "summary" | "live" | "degraded" | "ledger_live_fallback"
  fullyDegraded: boolean
}): DashboardClusterSource {
  if (input.fullyDegraded) return "degraded"
  if (input.cacheSource === "cache_hit") return "cache"
  if (input.metricsSource === "degraded") return "degraded"
  if (
    input.metricsSource === "live" ||
    input.metricsSource === "ledger_live_fallback" ||
    input.timelineSource === "live_first_load_fallback" ||
    input.timelineSource === "summary_stale_live_patch"
  ) {
    return "live"
  }
  if (
    input.metricsSource === "summary" ||
    input.timelineSource.startsWith("summary_")
  ) {
    return "summary"
  }
  return "degraded"
}
