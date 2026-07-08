/**
 * Reports P&L request-path refresh policy (mixed operational load gate).
 *
 * Default OFF: reports_pnl reads snapshot/cache only — no live ledger RPC or
 * snapshot refresh in the request path. Enable with FINZA_REPORTS_PNL_REFRESH_ON_REQUEST=1
 * for controlled validation or manual priming workflows.
 */

import type { PnlReportCacheStatus } from "@/lib/server/pnlReportCache"

export type ReportsRefreshOnRequestDiag = "enabled" | "disabled"

export type ReportsPnlSource =
  | "cache"
  | "expired_cache"
  | "fresh_snapshot"
  | "stale_snapshot"
  | "live"
  | "unavailable"

export function isReportsPnlRefreshOnRequestEnabled(): boolean {
  const raw = String(process.env.FINZA_REPORTS_PNL_REFRESH_ON_REQUEST ?? "").trim()
  return raw === "1" || raw.toLowerCase() === "true"
}

export function reportsRefreshOnRequestDiag(): ReportsRefreshOnRequestDiag {
  return isReportsPnlRefreshOnRequestEnabled() ? "enabled" : "disabled"
}

export function reportsRefreshSkipped(refreshOnRequest: boolean): boolean {
  return !refreshOnRequest
}

export type ReportsPnlDiagnostics = {
  reports_refresh_on_request: ReportsRefreshOnRequestDiag
  reports_source: ReportsPnlSource
  reports_cache_status: PnlReportCacheStatus
  reports_refresh_skipped: boolean
  reports_snapshot_stale: boolean
}

export function buildReportsPnlDiagnostics(input: {
  refreshOnRequest: boolean
  reportsSource: ReportsPnlSource
  cacheStatus: PnlReportCacheStatus
  snapshotStale: boolean
}): ReportsPnlDiagnostics {
  return {
    reports_refresh_on_request: reportsRefreshOnRequestDiag(),
    reports_source: input.reportsSource,
    reports_cache_status: input.cacheStatus,
    reports_refresh_skipped: reportsRefreshSkipped(input.refreshOnRequest),
    reports_snapshot_stale: input.snapshotStale,
  }
}

export function reportsPnlResponseHeaders(diagnostics: ReportsPnlDiagnostics): Record<string, string> {
  return {
    "x-finza-reports-source": diagnostics.reports_source,
    "x-finza-reports-cache": diagnostics.reports_cache_status,
    "x-finza-reports-refresh-on-request": diagnostics.reports_refresh_on_request,
  }
}

export function resolveReportsPnlSource(input: {
  cacheStatus: PnlReportCacheStatus
  movementSource: "snapshot" | "ledger" | "unavailable" | "zero_initialized"
  snapshotStale: boolean
  servedExpiredCache: boolean
}): ReportsPnlSource {
  if (input.cacheStatus === "hit") return "cache"
  if (input.cacheStatus === "expired_served" || input.servedExpiredCache) return "expired_cache"
  if (input.movementSource === "ledger") return "live"
  if (input.movementSource === "unavailable") return "unavailable"
  if (input.movementSource === "snapshot" || input.movementSource === "zero_initialized") {
    return input.snapshotStale ? "stale_snapshot" : "fresh_snapshot"
  }
  return "unavailable"
}
