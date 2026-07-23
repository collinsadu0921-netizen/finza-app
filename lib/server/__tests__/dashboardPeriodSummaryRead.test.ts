/**
 * @jest-environment node
 */

import {
  dashboardFinancialSourceForDiag,
  dashboardPnlSourceForDiag,
  isDashboardPnlSummaryFastPathEnabled,
} from "../dashboardPeriodSummaryRead"

describe("dashboardPeriodSummaryRead flags", () => {
  const prev = process.env.FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH
    } else {
      process.env.FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH = prev
    }
  })

  it("compat flag defaults off (summary path no longer depends on it)", () => {
    delete process.env.FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH
    expect(isDashboardPnlSummaryFastPathEnabled()).toBe(false)
    expect(dashboardPnlSourceForDiag(false)).toBe("live_metrics_rpc")
  })

  it("compat flag still readable when FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH=1", () => {
    process.env.FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH = "1"
    expect(isDashboardPnlSummaryFastPathEnabled()).toBe(true)
    expect(dashboardPnlSourceForDiag(true)).toBe("summary_fast_path")
  })

  it("maps truthful dashboard_financial_source values", () => {
    expect(
      dashboardFinancialSourceForDiag({
        cacheHit: true,
        usedSummaryFastPath: true,
        usedLiveFallback: false,
      })
    ).toBe("cache_hit")
    expect(
      dashboardFinancialSourceForDiag({
        cacheHit: false,
        usedSummaryFastPath: true,
        usedLiveFallback: false,
      })
    ).toBe("fresh_snapshot")
    expect(
      dashboardFinancialSourceForDiag({
        cacheHit: false,
        usedSummaryFastPath: false,
        usedLiveFallback: true,
      })
    ).toBe("live_fallback")
  })
})
