/**
 * Reports P&L request-path refresh policy (mixed operational load gate).
 *
 * Default OFF: reports_pnl reads snapshot/cache only — no live ledger RPC or
 * snapshot refresh in the request path. Enable with FINZA_REPORTS_PNL_REFRESH_ON_REQUEST=1
 * for controlled validation or manual priming workflows.
 */

export type ReportsRefreshOnRequestDiag = "enabled" | "disabled"

export type ReportsPnlSource =
  | "cache"
  | "stale_cache"
  | "fresh_snapshot"
  | "stale_snapshot"
  | "unavailable"

export type ReportsPnlCacheHeader = "fresh_hit" | "stale_hit" | "miss" | "refresh_started"

export type ReportsPnlRemoteCacheHeader = "hit" | "stale_hit" | "miss" | "error"

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
  reports_cache_header: ReportsPnlCacheHeader
  reports_remote_cache_header: ReportsPnlRemoteCacheHeader
  reports_refresh_skipped: boolean
  reports_snapshot_stale: boolean
}

export function buildReportsPnlDiagnostics(input: {
  refreshOnRequest: boolean
  reportsSource: ReportsPnlSource
  cacheHeader: ReportsPnlCacheHeader
  remoteCacheHeader: ReportsPnlRemoteCacheHeader
  snapshotStale: boolean
}): ReportsPnlDiagnostics {
  return {
    reports_refresh_on_request: reportsRefreshOnRequestDiag(),
    reports_source: input.reportsSource,
    reports_cache_header: input.cacheHeader,
    reports_remote_cache_header: input.remoteCacheHeader,
    reports_refresh_skipped: reportsRefreshSkipped(input.refreshOnRequest),
    reports_snapshot_stale: input.snapshotStale,
  }
}

export function reportsPnlResponseHeaders(diagnostics: ReportsPnlDiagnostics): Record<string, string> {
  return {
    "x-finza-reports-source": diagnostics.reports_source,
    "x-finza-reports-cache": diagnostics.reports_cache_header,
    "x-finza-reports-remote-cache": diagnostics.reports_remote_cache_header,
    "x-finza-reports-refresh-on-request": diagnostics.reports_refresh_on_request,
  }
}

export function resolveReportsPnlSource(input: {
  movementSource: "snapshot" | "ledger" | "unavailable" | "zero_initialized"
  snapshotStale: boolean
}): ReportsPnlSource {
  if (input.movementSource === "ledger") return "fresh_snapshot"
  if (input.movementSource === "unavailable") return "unavailable"
  if (input.movementSource === "snapshot" || input.movementSource === "zero_initialized") {
    return input.snapshotStale ? "stale_snapshot" : "fresh_snapshot"
  }
  return "unavailable"
}
