/**
 * Client helpers for /api/dashboard/service-cluster readiness + polling.
 */

import type { DashboardClusterStatus } from "@/lib/server/dashboardClusterStatus"

export type { DashboardClusterStatus }

export const MAX_DASHBOARD_CLUSTER_POLL_ATTEMPTS = 12

export function isDashboardClusterRenderable(
  status: DashboardClusterStatus | undefined,
  ready: boolean | undefined
): boolean {
  if (ready === false) return false
  if (status === "preparing") return false
  return true
}

export function shouldPollDashboardCluster(
  status: DashboardClusterStatus | undefined,
  ready: boolean | undefined,
  metricsReady?: boolean
): boolean {
  return status === "preparing" || ready === false || metricsReady === false
}

/** Backoff delay in ms for preparing-state auto-refetch (2s base, capped at 8s). */
export function nextDashboardPollDelayMs(attempt: number): number {
  const base = 2000
  const max = 8000
  return Math.min(Math.round(base * Math.pow(1.5, attempt)), max)
}
