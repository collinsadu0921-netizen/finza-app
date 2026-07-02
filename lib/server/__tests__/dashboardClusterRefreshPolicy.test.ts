import {
  dashboardRefreshOnRequestDiag,
  dashboardRefreshSkipped,
  isDashboardClusterRefreshOnRequestEnabled,
  resolveDashboardClusterSource,
} from "../dashboardClusterRefreshPolicy"

describe("dashboardClusterRefreshPolicy", () => {
  const prev = process.env.FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST
    } else {
      process.env.FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST = prev
    }
  })

  it("refresh on request disabled by default", () => {
    delete process.env.FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST
    expect(isDashboardClusterRefreshOnRequestEnabled()).toBe(false)
    expect(dashboardRefreshOnRequestDiag()).toBe("disabled")
    expect(dashboardRefreshSkipped(false)).toBe(true)
  })

  it("refresh on request enabled when FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST=1", () => {
    process.env.FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST = "1"
    expect(isDashboardClusterRefreshOnRequestEnabled()).toBe(true)
    expect(dashboardRefreshOnRequestDiag()).toBe("enabled")
    expect(dashboardRefreshSkipped(true)).toBe(false)
  })

  it("resolveDashboardClusterSource maps cache and summary", () => {
    expect(
      resolveDashboardClusterSource({
        cacheSource: "cache_hit",
        timelineSource: "summary_fresh",
        metricsSource: "summary",
        fullyDegraded: false,
      })
    ).toBe("cache")

    expect(
      resolveDashboardClusterSource({
        cacheSource: "cache_miss",
        timelineSource: "summary_stale",
        metricsSource: "summary",
        fullyDegraded: false,
      })
    ).toBe("summary")

    expect(
      resolveDashboardClusterSource({
        cacheSource: "cache_miss",
        timelineSource: "live_first_load_fallback",
        metricsSource: "live",
        fullyDegraded: false,
      })
    ).toBe("live")

    expect(
      resolveDashboardClusterSource({
        cacheSource: "cache_miss",
        timelineSource: "degraded",
        metricsSource: "degraded",
        fullyDegraded: true,
      })
    ).toBe("degraded")
  })
})
