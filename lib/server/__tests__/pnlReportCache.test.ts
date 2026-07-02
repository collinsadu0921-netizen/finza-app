/**
 * pnlReportCache — full final-response cache + singleflight for reports_pnl.
 */

import type { PnLReportResponse } from "@/lib/accounting/reports/getProfitAndLossReport"
import {
  buildPnlReportCacheKey,
  buildPnlReportQueryFingerprint,
  expirePnlReportCacheEntryForTests,
  loadOrComputePnlReportCache,
  resetPnlReportCacheForTests,
  shouldCachePnlReportPayload,
} from "../pnlReportCache"

const sampleReport = (): PnLReportResponse => ({
  period: {
    period_id: "period-1",
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    resolution_reason: "period_id",
  },
  currency: { code: "GHS", symbol: "₵", name: "Ghanaian Cedi" },
  sections: [
    {
      key: "income",
      label: "Income",
      lines: [{ account_id: "a1", account_code: "4000", account_name: "Revenue", amount: 100 }],
      subtotal: 100,
    },
  ],
  totals: {
    gross_profit: 100,
    operating_profit: 100,
    profit_before_tax: 100,
    net_profit: 100,
  },
  telemetry: {
    resolved_period_reason: "period_id",
    resolved_period_start: "2026-01-01",
    resolved_period_end: "2026-01-31",
    source: "snapshot",
    version: 2,
  },
})

const sampleLoadMeta = () => ({
  movementSource: "snapshot" as const,
  snapshotStale: false,
})

describe("pnlReportCache", () => {
  const prevTtl = process.env.FINZA_PNL_REPORT_CACHE_TTL_SEC

  beforeEach(() => {
    resetPnlReportCacheForTests()
    process.env.FINZA_PNL_REPORT_CACHE_TTL_SEC = "30"
  })

  afterEach(() => {
    resetPnlReportCacheForTests()
    if (prevTtl === undefined) {
      delete process.env.FINZA_PNL_REPORT_CACHE_TTL_SEC
    } else {
      process.env.FINZA_PNL_REPORT_CACHE_TTL_SEC = prevTtl
    }
  })

  it("buildPnlReportCacheKey includes business, range, query, and refresh mode", () => {
    const fp = buildPnlReportQueryFingerprint({ period_id: "period-1" })
    expect(
      buildPnlReportCacheKey({
        businessId: "biz-1",
        movementStart: "2026-01-01",
        movementEnd: "2026-01-31",
        queryFingerprint: fp,
        refreshOnRequest: false,
      })
    ).toBe("pnl|biz-1|2026-01-01|2026-01-31|period-1|||||norefresh")
  })

  it("shouldCachePnlReportPayload requires sections, period, and totals", () => {
    expect(shouldCachePnlReportPayload(sampleReport())).toBe(true)
    expect(shouldCachePnlReportPayload({ error: "forbidden" })).toBe(false)
  })

  it("caches final report payload and returns hit on repeat", async () => {
    let computeCalls = 0
    const key = `test-pnl-cache-${Date.now()}-${Math.random()}`
    const payload = sampleReport()

    const compute = async () => {
      computeCalls += 1
      return { payload, loadMeta: sampleLoadMeta() }
    }

    const first = await loadOrComputePnlReportCache(key, compute)
    const second = await loadOrComputePnlReportCache(key, compute)

    expect(first.cacheStatus).toBe("miss")
    expect(second.cacheStatus).toBe("hit")
    expect(computeCalls).toBe(1)
    expect(second.value.data).toEqual(payload)
    expect(second.value.data).not.toBe(first.value.data)
  })

  it("singleflight concurrent same-key rebuilds once", async () => {
    let computeCalls = 0
    const key = `test-pnl-flight-${Date.now()}-${Math.random()}`
    const payload = sampleReport()

    const compute = async () => {
      computeCalls += 1
      await new Promise((r) => setTimeout(r, 50))
      return { payload, loadMeta: sampleLoadMeta() }
    }

    const results = await Promise.all([
      loadOrComputePnlReportCache(key, compute),
      loadOrComputePnlReportCache(key, compute),
      loadOrComputePnlReportCache(key, compute),
    ])

    expect(computeCalls).toBe(1)
    const statuses = results.map((r) => r.cacheStatus).sort()
    expect(statuses).toContain("miss")
    expect(statuses.filter((s) => s === "singleflight_joined")).toHaveLength(2)
    for (const r of results) {
      expect(r.value.data).toEqual(payload)
    }
  })

  it("serves expired cache while identical rebuild is in flight", async () => {
    const key = `test-pnl-expired-flight-${Date.now()}-${Math.random()}`
    const payload = sampleReport()
    let computeCalls = 0
    let releaseCompute!: () => void
    const computeGate = new Promise<void>((resolve) => {
      releaseCompute = resolve
    })

    await loadOrComputePnlReportCache(key, async () => ({
      payload,
      loadMeta: sampleLoadMeta(),
    }))
    expirePnlReportCacheEntryForTests(key)

    const slowCompute = async () => {
      computeCalls += 1
      await computeGate
      return {
        payload: { ...payload, totals: { ...payload.totals, net_profit: 999 } },
        loadMeta: sampleLoadMeta(),
      }
    }

    const ownerPromise = loadOrComputePnlReportCache(key, slowCompute)
    await new Promise((r) => setImmediate(r))
    const joiner = await loadOrComputePnlReportCache(key, slowCompute)

    expect(joiner.cacheStatus).toBe("expired_served")
    expect(joiner.servedExpiredCache).toBe(true)
    expect(joiner.value.data.totals.net_profit).toBe(100)

    releaseCompute()
    await ownerPromise
    expect(computeCalls).toBe(1)
  })

  it("serveExpiredOnMiss returns expired payload when compute returns null", async () => {
    const key = `test-pnl-expired-miss-${Date.now()}-${Math.random()}`
    const payload = sampleReport()

    await loadOrComputePnlReportCache(key, async () => ({
      payload,
      loadMeta: sampleLoadMeta(),
    }))
    expirePnlReportCacheEntryForTests(key)

    const stale = await loadOrComputePnlReportCache(
      key,
      async () => null,
      { serveExpiredOnMiss: true }
    )

    expect(stale.cacheStatus).toBe("expired_served")
    expect(stale.value.data).toEqual(payload)
  })
})
