/**
 * operationalListCache — short TTL cache for list routes (510).
 */

import {
  loadOrComputeOperationalListCache,
  shouldCacheOperationalListPayload,
} from "../operationalListCache"

describe("operationalListCache", () => {
  const prevTtl = process.env.FINZA_OPERATIONAL_LIST_CACHE_TTL_SEC

  beforeEach(() => {
    process.env.FINZA_OPERATIONAL_LIST_CACHE_TTL_SEC = "30"
  })

  afterEach(() => {
    if (prevTtl === undefined) {
      delete process.env.FINZA_OPERATIONAL_LIST_CACHE_TTL_SEC
    } else {
      process.env.FINZA_OPERATIONAL_LIST_CACHE_TTL_SEC = prevTtl
    }
  })

  it("shouldCacheOperationalListPayload rejects error payloads", () => {
    expect(shouldCacheOperationalListPayload({ error: "forbidden" })).toBe(false)
    expect(shouldCacheOperationalListPayload({ bills: [], pagination: {} })).toBe(true)
  })

  it("does not cache values rejected by shouldStore", async () => {
    let computeCalls = 0
    const key = `test-no-error-cache-${Date.now()}-${Math.random()}`

    const compute = async () => {
      computeCalls += 1
      return { error: "db_down" }
    }

    await loadOrComputeOperationalListCache(key, compute)
    await loadOrComputeOperationalListCache(key, compute)
    expect(computeCalls).toBe(2)
  })

  it("caches successful list payloads", async () => {
    let computeCalls = 0
    const key = `test-list-cache-${Date.now()}-${Math.random()}`

    const compute = async () => {
      computeCalls += 1
      return { invoices: [{ id: "a" }], pagination: { page: 1 } }
    }

    await loadOrComputeOperationalListCache(key, compute)
    const second = await loadOrComputeOperationalListCache(key, compute)
    expect(second.source).toBe("cache_hit")
    expect(computeCalls).toBe(1)
  })
})
