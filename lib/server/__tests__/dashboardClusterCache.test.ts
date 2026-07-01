/**
 * dashboardClusterCache — do not store empty timeline when shouldStore rejects.
 */

import {
  isDashboardClusterCacheEnabled,
  loadOrComputeDashboardClusterCache,
} from "../dashboardClusterCache"

describe("loadOrComputeDashboardClusterCache shouldStore", () => {
  const prevTtl = process.env.FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC

  beforeEach(() => {
    process.env.FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC = "30"
  })

  afterEach(() => {
    if (prevTtl === undefined) {
      delete process.env.FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC
    } else {
      process.env.FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC = prevTtl
    }
  })

  it("does not cache values rejected by shouldStore", async () => {
    expect(isDashboardClusterCacheEnabled()).toBe(true)
    let computeCalls = 0
    const key = `test-empty-not-cached-${Date.now()}-${Math.random()}`

    const compute = async () => {
      computeCalls += 1
      return { timeline: [], cacheable: false }
    }

    const first = await loadOrComputeDashboardClusterCache(key, compute, {
      shouldStore: (v) => v.cacheable,
    })
    expect(first.source).toBe("cache_miss")
    expect(computeCalls).toBe(1)

    const second = await loadOrComputeDashboardClusterCache(key, compute, {
      shouldStore: (v) => v.cacheable,
    })
    expect(second.source).toBe("cache_miss")
    expect(computeCalls).toBe(2)
  })

  it("caches values accepted by shouldStore", async () => {
    let computeCalls = 0
    const key = `test-cached-${Date.now()}-${Math.random()}`

    const compute = async () => {
      computeCalls += 1
      return { timeline: [{ period_start: "2026-01-01" }], cacheable: true }
    }

    await loadOrComputeDashboardClusterCache(key, compute, {
      shouldStore: (v) => v.cacheable,
    })
    const second = await loadOrComputeDashboardClusterCache(key, compute, {
      shouldStore: (v) => v.cacheable,
    })
    expect(second.source).toBe("cache_hit")
    expect(computeCalls).toBe(1)
  })
})
