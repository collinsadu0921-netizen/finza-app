import {
  buildReportsPnlDiagnostics,
  isReportsPnlRefreshOnRequestEnabled,
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
    expect(
      buildReportsPnlDiagnostics({
        refreshOnRequest: false,
        reportsSource: "fresh_snapshot",
        snapshotStale: false,
      }).reports_refresh_skipped
    ).toBe(true)
  })

  it("refresh on request enabled when FINZA_REPORTS_PNL_REFRESH_ON_REQUEST=1", () => {
    process.env.FINZA_REPORTS_PNL_REFRESH_ON_REQUEST = "1"
    expect(isReportsPnlRefreshOnRequestEnabled()).toBe(true)
  })

  it("resolveReportsPnlSource maps cache and snapshot sources", () => {
    expect(
      resolveReportsPnlSource({
        cacheSource: "cache_hit",
        movementSource: "snapshot",
        snapshotStale: false,
        servedExpiredCache: false,
      })
    ).toBe("cache")

    expect(
      resolveReportsPnlSource({
        cacheSource: "cache_miss",
        movementSource: "snapshot",
        snapshotStale: true,
        servedExpiredCache: false,
      })
    ).toBe("stale_snapshot")

    expect(
      resolveReportsPnlSource({
        cacheSource: "cache_miss",
        movementSource: "ledger",
        snapshotStale: false,
        servedExpiredCache: false,
      })
    ).toBe("live")
  })
})
