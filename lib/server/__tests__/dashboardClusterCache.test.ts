/**
 * dashboardClusterCache — SWR / dogpile protection for dashboard cluster.
 */

import {
  expireDashboardClusterCacheSoftForTests,
  isDashboardClusterCacheEnabled,
  loadOrComputeDashboardClusterCache,
  resetDashboardClusterCacheForTests,
} from "../dashboardClusterCache"

describe("loadOrComputeDashboardClusterCache shouldStore", () => {
  const prevSoft = process.env.FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC
  const prevHard = process.env.FINZA_DASHBOARD_CLUSTER_CACHE_HARD_TTL_SEC
  const prevTimeout = process.env.FINZA_DASHBOARD_CLUSTER_COMPUTE_TIMEOUT_MS

  beforeEach(() => {
    resetDashboardClusterCacheForTests()
    process.env.FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC = "30"
    delete process.env.FINZA_DASHBOARD_CLUSTER_CACHE_HARD_TTL_SEC
    delete process.env.FINZA_DASHBOARD_CLUSTER_COMPUTE_TIMEOUT_MS
  })

  afterEach(() => {
    resetDashboardClusterCacheForTests()
    if (prevSoft === undefined) {
      delete process.env.FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC
    } else {
      process.env.FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC = prevSoft
    }
    if (prevHard === undefined) {
      delete process.env.FINZA_DASHBOARD_CLUSTER_CACHE_HARD_TTL_SEC
    } else {
      process.env.FINZA_DASHBOARD_CLUSTER_CACHE_HARD_TTL_SEC = prevHard
    }
    if (prevTimeout === undefined) {
      delete process.env.FINZA_DASHBOARD_CLUSTER_COMPUTE_TIMEOUT_MS
    } else {
      process.env.FINZA_DASHBOARD_CLUSTER_COMPUTE_TIMEOUT_MS = prevTimeout
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
    expect(first.cacheSource).toBe("miss")
    expect(computeCalls).toBe(1)

    const second = await loadOrComputeDashboardClusterCache(key, compute, {
      shouldStore: (v) => v.cacheable,
    })
    expect(second.cacheSource).toBe("miss")
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
    expect(second.cacheSource).toBe("fresh_hit")
    expect(second.source).toBe("cache_hit")
    expect(computeCalls).toBe(1)
  })

  it("serves stale immediately and schedules background refresh", async () => {
    const key = `test-stale-refresh-${Date.now()}-${Math.random()}`
    const payload = { timeline: [{ period_start: "2026-01-01" }], cacheable: true }
    let computeCalls = 0
    let releaseCompute!: () => void
    const computeGate = new Promise<void>((resolve) => {
      releaseCompute = resolve
    })

    const scheduled: Promise<void>[] = []

    await loadOrComputeDashboardClusterCache(key, async () => {
      computeCalls += 1
      return payload
    })

    expireDashboardClusterCacheSoftForTests(key)

    const stalePromise = loadOrComputeDashboardClusterCache(
      key,
      async () => {
        computeCalls += 1
        await computeGate
        return { timeline: [{ period_start: "2026-02-01" }], cacheable: true }
      },
      {
        shouldStore: (v) => v.cacheable,
        scheduleBackground: (p) => {
          scheduled.push(p)
        },
      }
    )

    const stale = await stalePromise
    expect(stale.cacheSource).toBe("refresh_started")
    expect(stale.refresh_mode).toBe("background")
    expect(stale.value).toEqual(payload)
    expect(computeCalls).toBe(1)
    expect(scheduled.length).toBe(1)

    releaseCompute()
    await scheduled[0]

    const third = await loadOrComputeDashboardClusterCache(key, async () => {
      computeCalls += 1
      return payload
    })
    expect(third.cacheSource).toBe("fresh_hit")
    expect(computeCalls).toBe(2)
  })

  it("returns degraded fast for waiters when no stale entry exists", async () => {
    const key = `test-waiter-degraded-${Date.now()}-${Math.random()}`
    let releaseCompute!: () => void
    const computeGate = new Promise<void>((resolve) => {
      releaseCompute = resolve
    })

    const degraded = { timeline: [], degraded: true }

    const owner = loadOrComputeDashboardClusterCache(
      key,
      async () => {
        await computeGate
        return { timeline: [{ period_start: "2026-01-01" }], cacheable: true }
      },
      { shouldStore: () => true }
    )

    const waiter = await loadOrComputeDashboardClusterCache(
      key,
      async () => {
        throw new Error("should not compute")
      },
      { createDegraded: () => degraded }
    )

    expect(waiter.cacheSource).toBe("degraded")
    expect(waiter.value).toEqual(degraded)

    releaseCompute()
    await owner
  })
})
