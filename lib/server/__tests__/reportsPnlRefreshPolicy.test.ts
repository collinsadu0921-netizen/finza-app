import {
  buildReportsPnlDiagnostics,
  isReportsPnlRefreshOnRequestEnabled,
  reportsPnlResponseHeaders,
  resolveReportsPnlSource,
} from "../reportsPnlRefreshPolicy"

describe("reportsPnlRefreshPolicy", () => {
  const prev = process.env.FINZA_REPORTS_PNL_REFRESH_ON_REQUEST

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.FINZA_REPORTS_PNL_REFRESH_ON_REQUEST
    } else {
      process.env.FINZA_REPORTS_PNL_REFRESH_ON_REQUEST = prev
    }
  })

  it("refresh on request disabled by default", () => {
    delete process.env.FINZA_REPORTS_PNL_REFRESH_ON_REQUEST
    expect(isReportsPnlRefreshOnRequestEnabled()).toBe(false)
  })

  it("resolveReportsPnlSource maps cache statuses", () => {
    expect(
      resolveReportsPnlSource({
        cacheStatus: "hit",
        movementSource: "snapshot",
        snapshotStale: false,
        servedExpiredCache: false,
      })
    ).toBe("cache")

    expect(
      resolveReportsPnlSource({
        cacheStatus: "expired_served",
        movementSource: "snapshot",
        snapshotStale: true,
        servedExpiredCache: true,
      })
    ).toBe("expired_cache")

    expect(
      resolveReportsPnlSource({
        cacheStatus: "miss",
        movementSource: "snapshot",
        snapshotStale: true,
        servedExpiredCache: false,
      })
    ).toBe("stale_snapshot")
  })

  it("reportsPnlResponseHeaders exposes diagnostics without secrets", () => {
    const diagnostics = buildReportsPnlDiagnostics({
      refreshOnRequest: false,
      reportsSource: "cache",
      cacheStatus: "hit",
      snapshotStale: false,
    })
    expect(reportsPnlResponseHeaders(diagnostics)).toEqual({
      "x-finza-reports-source": "cache",
      "x-finza-reports-cache": "hit",
      "x-finza-reports-refresh-on-request": "disabled",
    })
  })
})
