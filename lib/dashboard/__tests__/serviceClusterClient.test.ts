import {
  isDashboardClusterRenderable,
  nextDashboardPollDelayMs,
  shouldPollDashboardCluster,
} from "@/lib/dashboard/serviceClusterClient"

describe("serviceClusterClient", () => {
  it("does not render preparing responses", () => {
    expect(isDashboardClusterRenderable("preparing", false)).toBe(false)
    expect(isDashboardClusterRenderable(undefined, false)).toBe(false)
  })

  it("renders fresh and stale responses", () => {
    expect(isDashboardClusterRenderable("fresh", true)).toBe(true)
    expect(isDashboardClusterRenderable("stale", true)).toBe(true)
    expect(isDashboardClusterRenderable(undefined, undefined)).toBe(true)
  })

  it("polls only while preparing", () => {
    expect(shouldPollDashboardCluster("preparing", false)).toBe(true)
    expect(shouldPollDashboardCluster("fresh", true)).toBe(false)
  })

  it("backs off poll delay", () => {
    expect(nextDashboardPollDelayMs(0)).toBe(2000)
    expect(nextDashboardPollDelayMs(1)).toBe(3000)
    expect(nextDashboardPollDelayMs(10)).toBeLessThanOrEqual(8000)
  })
})
