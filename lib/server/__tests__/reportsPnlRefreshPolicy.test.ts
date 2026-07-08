import {
  buildReportsPnlDiagnostics,
  isReportsPnlRefreshOnRequestEnabled,
  reportsPnlResponseHeaders,
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

  it("resolveReportsPnlSource maps movement sources", () => {
    const { resolveReportsPnlSource } = require("../reportsPnlRefreshPolicy") as typeof import("../reportsPnlRefreshPolicy")

    expect(
      resolveReportsPnlSource({
        movementSource: "snapshot",
        snapshotStale: false,
      })
    ).toBe("fresh_snapshot")

    expect(
      resolveReportsPnlSource({
        movementSource: "snapshot",
        snapshotStale: true,
      })
    ).toBe("stale_snapshot")

    expect(
      resolveReportsPnlSource({
        movementSource: "ledger",
        snapshotStale: false,
      })
    ).toBe("fresh_snapshot")
  })

  it("reportsPnlResponseHeaders exposes diagnostics without secrets", () => {
    const diagnostics = buildReportsPnlDiagnostics({
      refreshOnRequest: false,
      reportsSource: "cache",
      cacheHeader: "fresh_hit",
      remoteCacheHeader: "hit",
      snapshotStale: false,
    })
    expect(reportsPnlResponseHeaders(diagnostics)).toEqual({
      "x-finza-reports-source": "cache",
      "x-finza-reports-cache": "fresh_hit",
      "x-finza-reports-remote-cache": "hit",
      "x-finza-reports-refresh-on-request": "disabled",
    })
  })
})
