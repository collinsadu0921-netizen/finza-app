import {
  invalidateDashboardMetricsCacheForBusiness,
  invalidatePnlReportCachesForBusiness,
} from "../accountingSnapshotCacheInvalidation"
import {
  invalidatePnlReportCacheForBusiness,
  isPnlReportCacheEnabled,
  resetPnlReportCacheForTests,
} from "../pnlReportCache"
import {
  invalidateDashboardMetricsCachePrefix,
  setCachedDashboardMetrics,
  getCachedDashboardMetrics,
} from "../dashboardMetricsCache"

jest.mock("@vercel/functions", () => ({
  getCache: () => ({
    expireTag: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    set: jest.fn(),
  }),
}))

describe("accountingSnapshotCacheInvalidation", () => {
  const prevTtl = process.env.FINZA_DASHBOARD_METRICS_CACHE_TTL_SEC

  beforeEach(() => {
    resetPnlReportCacheForTests()
    process.env.FINZA_DASHBOARD_METRICS_CACHE_TTL_SEC = "30"
  })

  afterAll(() => {
    if (prevTtl === undefined) delete process.env.FINZA_DASHBOARD_METRICS_CACHE_TTL_SEC
    else process.env.FINZA_DASHBOARD_METRICS_CACHE_TTL_SEC = prevTtl
  })

  it("clears dashboard metrics cache entries for a business", () => {
    const key = "biz-1|2026-07-01|2026-07-31|2026-07-22||"
    setCachedDashboardMetrics(key, { expenses: 1 })
    expect(getCachedDashboardMetrics(key)).toEqual({ expenses: 1 })
    invalidateDashboardMetricsCachePrefix("biz-1")
    expect(getCachedDashboardMetrics(key)).toBeNull()
  })

  it("exports business invalidation helpers", async () => {
    expect(typeof invalidatePnlReportCacheForBusiness).toBe("function")
    expect(typeof invalidateDashboardMetricsCacheForBusiness).toBe("function")
    await expect(invalidatePnlReportCachesForBusiness("biz-1")).resolves.toBeUndefined()
    invalidateDashboardMetricsCacheForBusiness("biz-1")
    expect(typeof isPnlReportCacheEnabled()).toBe("boolean")
  })
})
