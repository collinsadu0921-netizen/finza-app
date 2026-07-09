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
  const prevForeground = process.env.FINZA_DASHBOARD_CLUSTER_FOREGROUND_MS

  beforeEach(() => {
    resetDashboardClusterCacheForTests()
    process.env.FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC = "30"
    delete process.env.FINZA_DASHBOARD_CLUSTER_CACHE_HARD_TTL_SEC
    delete process.env.FINZA_DASHBOARD_CLUSTER_COMPUTE_TIMEOUT_MS
    delete process.env.FINZA_DASHBOARD_CLUSTER_FOREGROUND_MS
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
    if (prevForeground === undefined) {
      delete process.env.FINZA_DASHBOARD_CLUSTER_FOREGROUND_MS
    } else {
      process.env.FINZA_DASHBOARD_CLUSTER_FOREGROUND_MS = prevForeground
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

  it("returns preparing fast for waiters when no stale entry exists", async () => {
    const key = `test-waiter-preparing-${Date.now()}-${Math.random()}`
    let releaseCompute!: () => void
    const computeGate = new Promise<void>((resolve) => {
      releaseCompute = resolve
    })

    const preparing = { timeline: [], preparing: true }
    const scheduled: Promise<void>[] = []

    const owner = loadOrComputeDashboardClusterCache(
      key,
      async () => {
        await computeGate
        return { timeline: [{ period_start: "2026-01-01" }], cacheable: true }
      },
      {
        shouldStore: () => true,
        scheduleBackground: (p) => {
          scheduled.push(p)
        },
      }
    )

    const waiter = await loadOrComputeDashboardClusterCache(
      key,
      async () => {
        throw new Error("should not compute")
      },
      {
        createPreparing: () => preparing,
        scheduleBackground: (p) => {
          scheduled.push(p)
        },
      }
    )

    expect(waiter.cacheSource).toBe("preparing")
    expect(waiter.value).toEqual(preparing)
    expect(waiter.refresh_mode).toBe("background")
    expect(scheduled.length).toBeGreaterThanOrEqual(1)

    releaseCompute()
    await owner
  })

  it(
    "returns preparing on foreground timeout when no stale entry exists",
    async () => {
      process.env.FINZA_DASHBOARD_CLUSTER_FOREGROUND_MS = "2000"
      const key = `test-foreground-preparing-${Date.now()}-${Math.random()}`
      const preparing = { timeline: [], preparing: true }
      const scheduled: Promise<void>[] = []

      const result = await loadOrComputeDashboardClusterCache(
        key,
        async () => {
          await new Promise((r) => setTimeout(r, 10000))
          return { timeline: [{ period_start: "2026-01-01" }], cacheable: true }
        },
        {
          shouldStore: () => true,
          createPreparing: () => preparing,
          scheduleBackground: (p) => {
            scheduled.push(p)
          },
        }
      )

      expect(result.cacheSource).toBe("preparing")
      expect(result.value).toEqual(preparing)
      expect(scheduled.length).toBe(1)
    },
    10000
  )
})
