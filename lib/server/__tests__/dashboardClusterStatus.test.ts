import {
  isDashboardClusterReady,
  resolveDashboardClusterStatus,
} from "../dashboardClusterStatus"

describe("resolveDashboardClusterStatus", () => {
  it("maps fresh cache hit to fresh", () => {
    expect(
      resolveDashboardClusterStatus("fresh_hit", {
        timeline: [{ period_start: "2026-01-01" }],
      })
    ).toBe("fresh")
  })

  it("maps stale cache sources to stale", () => {
    expect(
      resolveDashboardClusterStatus("stale_hit", {
        timeline: [{ period_start: "2026-01-01" }],
      })
    ).toBe("stale")
    expect(
      resolveDashboardClusterStatus("refresh_started", {
        timeline: [{ period_start: "2026-01-01" }],
      })
    ).toBe("stale")
  })

  it("maps preparing payload hints to preparing", () => {
    expect(
      resolveDashboardClusterStatus("preparing", {
        dashboard_ready: false,
        timelineSource: "preparing",
      })
    ).toBe("preparing")
    expect(
      resolveDashboardClusterStatus("miss", {
        metrics: { period: { resolution_reason: "preparing" } },
      })
    ).toBe("preparing")
  })

  it("maps degraded empty fake payload to preparing", () => {
    expect(
      resolveDashboardClusterStatus("degraded", {
        timeline: [],
        timelineSource: "degraded",
      })
    ).toBe("preparing")
  })

  it("maps degraded with stale timeline to degraded", () => {
    expect(
      resolveDashboardClusterStatus("degraded", {
        timeline: [{ period_start: "2026-01-01" }],
        timelineSource: "degraded",
      })
    ).toBe("degraded")
  })
})

describe("isDashboardClusterReady", () => {
  it("returns false only for preparing", () => {
    expect(isDashboardClusterReady("preparing")).toBe(false)
    expect(isDashboardClusterReady("fresh")).toBe(true)
    expect(isDashboardClusterReady("stale")).toBe(true)
    expect(isDashboardClusterReady("degraded")).toBe(true)
  })
})
