/**
 * @jest-environment node
 */

import {
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

  it("fast path disabled by default", () => {
    delete process.env.FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH
    expect(isDashboardPnlSummaryFastPathEnabled()).toBe(false)
    expect(dashboardPnlSourceForDiag(false)).toBe("live_metrics_rpc")
  })

  it("fast path enabled when FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH=1", () => {
    process.env.FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH = "1"
    expect(isDashboardPnlSummaryFastPathEnabled()).toBe(true)
    expect(dashboardPnlSourceForDiag(true)).toBe("summary_fast_path")
  })
})
