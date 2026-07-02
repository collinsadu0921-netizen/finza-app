/**
 * pnlReportCache — short TTL cache for reports_pnl route (512a).
 */

import type { PnLReportResponse } from "@/lib/accounting/reports/getProfitAndLossReport"
import {
  buildPnlReportCacheKey,
  buildPnlReportQueryFingerprint,
  loadOrComputePnlReportCache,
  pnlReportCacheSourceForDiag,
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
    source: "ledger",
    version: 2,
  },
})

describe("pnlReportCache", () => {
  const prevTtl = process.env.FINZA_PNL_REPORT_CACHE_TTL_SEC

  beforeEach(() => {
    process.env.FINZA_PNL_REPORT_CACHE_TTL_SEC = "30"
  })

  afterEach(() => {
    if (prevTtl === undefined) {
      delete process.env.FINZA_PNL_REPORT_CACHE_TTL_SEC
    } else {
      process.env.FINZA_PNL_REPORT_CACHE_TTL_SEC = prevTtl
    }
  })

  it("buildPnlReportCacheKey includes business, resolved range, and query fingerprint", () => {
    const fp = buildPnlReportQueryFingerprint({
      period_id: "period-1",
    })
    expect(
      buildPnlReportCacheKey("biz-1", "2026-01-01", "2026-01-31", fp)
    ).toBe("pnl|biz-1|2026-01-01|2026-01-31|period-1||||")
  })

  it("shouldCachePnlReportPayload requires sections, period, and totals", () => {
    expect(shouldCachePnlReportPayload(sampleReport())).toBe(true)
    expect(shouldCachePnlReportPayload({ error: "forbidden" })).toBe(false)
    expect(shouldCachePnlReportPayload({ period: {}, totals: {} })).toBe(false)
  })

  it("pnlReportCacheSourceForDiag maps sources", () => {
    expect(pnlReportCacheSourceForDiag("cache_hit", true)).toBe("hit")
    expect(pnlReportCacheSourceForDiag("cache_coalesce", true)).toBe("singleflight")
    expect(pnlReportCacheSourceForDiag("cache_miss", true)).toBe("miss")
    expect(pnlReportCacheSourceForDiag("cache_miss", false)).toBe("disabled")
  })

  it("caches successful report payloads and returns clones", async () => {
    let computeCalls = 0
    const key = `test-pnl-cache-${Date.now()}-${Math.random()}`
    const payload = sampleReport()

    const compute = async () => {
      computeCalls += 1
      return payload
    }

    const first = await loadOrComputePnlReportCache(key, compute)
    const second = await loadOrComputePnlReportCache(key, compute)

    expect(first.source).toBe("cache_miss")
    expect(second.source).toBe("cache_hit")
    expect(computeCalls).toBe(1)
    expect(second.value).not.toBe(first.value)
    expect(second.value).toEqual(payload)
  })

  it("does not cache values rejected by shouldStore", async () => {
    let computeCalls = 0
    const key = `test-pnl-no-cache-${Date.now()}-${Math.random()}`

    const compute = async () => {
      computeCalls += 1
      return { error: "db_down" }
    }

    await loadOrComputePnlReportCache(key, compute)
    await loadOrComputePnlReportCache(key, compute)
    expect(computeCalls).toBe(2)
  })
})
