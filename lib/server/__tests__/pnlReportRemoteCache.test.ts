/**
 * pnlReportRemoteCache — Vercel Runtime Cache L2 for reports_pnl.
 */

import type { PnLReportResponse } from "@/lib/accounting/reports/getProfitAndLossReport"
import {
  getPnlReportRemoteCacheEntry,
  isPnlReportRemoteCacheEnabled,
  resetPnlReportRemoteCacheForTests,
  setPnlReportRemoteCacheEntry,
  setPnlReportRemoteCacheForTests,
} from "../pnlReportRemoteCache"

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

const sampleValue = () => ({
  payload: sampleReport(),
  loadMeta: { movementSource: "snapshot" as const, snapshotStale: false },
})

function makeStoredEntry(cachedAt: string, hardTtlSec: number, softTtlSec: number) {
  return {
    payload: sampleReport(),
    loadMeta: { movementSource: "snapshot" as const, snapshotStale: false },
    cachedAt,
    hardTtlSec,
    softTtlSec,
  }
}

describe("pnlReportRemoteCache", () => {
  const prevRemoteTtl = process.env.FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC

  beforeEach(() => {
    resetPnlReportRemoteCacheForTests()
    process.env.FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC = "30"
  })

  afterEach(() => {
    resetPnlReportRemoteCacheForTests()
    jest.restoreAllMocks()
    if (prevRemoteTtl === undefined) {
      delete process.env.FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC
    } else {
      process.env.FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC = prevRemoteTtl
    }
  })

  it("is disabled when env TTL is 0", () => {
    process.env.FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC = "0"
    expect(isPnlReportRemoteCacheEnabled()).toBe(false)
  })

  it("clamps remote TTL to 15–120 seconds", async () => {
    process.env.FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC = "5"
    const store = new Map<string, unknown>()
    jest.spyOn(Math, "random").mockReturnValue(0.5)
    setPnlReportRemoteCacheForTests({
      get: async (key) => store.get(key),
      set: async (key, value, options) => {
        store.set(key, value)
        expect(options?.ttl).toBe(15)
      },
    })

    await setPnlReportRemoteCacheEntry("key-1", sampleValue(), { businessId: "biz-1" })
  })

  it("returns disabled when remote cache is off", async () => {
    process.env.FINZA_PNL_REPORT_REMOTE_CACHE_TTL_SEC = "0"
    const result = await getPnlReportRemoteCacheEntry("key-1")
    expect(result.status).toBe("miss")
  })

  it("returns hit on remote cache get", async () => {
    const store = new Map<string, unknown>()
    const key = "pnl|biz-1|2026-01-01|2026-01-31|||||norefresh"
    store.set(key, makeStoredEntry(new Date().toISOString(), 30, 24))
    setPnlReportRemoteCacheForTests({
      get: async (k) => store.get(k),
      set: async () => {},
    })

    const result = await getPnlReportRemoteCacheEntry(key)
    expect(result.status).toBe("hit")
    expect(result.entry?.payload.totals.net_profit).toBe(100)
  })

  it("returns stale_hit when beyond soft TTL but within hard TTL", async () => {
    const store = new Map<string, unknown>()
    const key = `pnl|biz-1|stale-${Date.now()}`
    const hardTtlSec = 30
    const softTtlSec = 24
    const cachedAt = new Date(Date.now() - (softTtlSec + 1) * 1000).toISOString()
    store.set(key, makeStoredEntry(cachedAt, hardTtlSec, softTtlSec))

    setPnlReportRemoteCacheForTests({
      get: async (k) => store.get(k),
      set: async () => {},
    })

    const result = await getPnlReportRemoteCacheEntry(key)
    expect(result.status).toBe("stale_hit")
    expect(result.entry?.payload.totals.net_profit).toBe(100)
  })

  it("returns miss when beyond hard TTL", async () => {
    const store = new Map<string, unknown>()
    const key = `pnl|biz-1|expired-${Date.now()}`
    const hardTtlSec = 30
    const softTtlSec = 24
    const cachedAt = new Date(Date.now() - (hardTtlSec + 2) * 1000).toISOString()
    store.set(key, makeStoredEntry(cachedAt, hardTtlSec, softTtlSec))

    setPnlReportRemoteCacheForTests({
      get: async (k) => store.get(k),
      set: async () => {},
    })

    const result = await getPnlReportRemoteCacheEntry(key)
    expect(result.status).toBe("miss")
    expect(result.entry).toBe(undefined)
  })

  it("stores entry on set with business tag", async () => {
    const store = new Map<string, unknown>()
    let savedTags: string[] | undefined
    jest.spyOn(Math, "random").mockReturnValue(0.5)
    setPnlReportRemoteCacheForTests({
      get: async (key) => store.get(key),
      set: async (key, value, options) => {
        store.set(key, value)
        savedTags = options?.tags
      },
    })

    const key = "pnl|biz-1|2026-01-01|2026-01-31|||||norefresh"
    const stored = await setPnlReportRemoteCacheEntry(key, sampleValue(), { businessId: "biz-1" })
    expect(stored).toBe("stored")
    expect(savedTags).toEqual(["reports_pnl", "business:biz-1"])
  })

  it("get returns error status when runtime cache throws", async () => {
    setPnlReportRemoteCacheForTests({
      get: async () => {
        throw new Error("runtime cache down")
      },
      set: async () => {},
    })

    const result = await getPnlReportRemoteCacheEntry("key-1")
    expect(result.status).toBe("error")
  })

  it("set returns error when runtime cache throws", async () => {
    setPnlReportRemoteCacheForTests({
      get: async () => undefined,
      set: async () => {
        throw new Error("runtime cache down")
      },
    })

    const stored = await setPnlReportRemoteCacheEntry("key-1", sampleValue())
    expect(stored).toBe("error")
  })

  it("does not store unavailable payloads", async () => {
    let setCalls = 0
    setPnlReportRemoteCacheForTests({
      get: async () => undefined,
      set: async () => {
        setCalls += 1
      },
    })

    const skipped = await setPnlReportRemoteCacheEntry("key-1", {
      payload: sampleReport(),
      loadMeta: { movementSource: "unavailable", snapshotStale: false },
    })
    expect(skipped).toBe("skipped")
    expect(setCalls).toBe(0)
  })

  it("does not store invalid payloads", async () => {
    let setCalls = 0
    setPnlReportRemoteCacheForTests({
      get: async () => undefined,
      set: async () => {
        setCalls += 1
      },
    })

    const skipped = await setPnlReportRemoteCacheEntry("key-1", {
      payload: { error: "forbidden" },
      loadMeta: { movementSource: "snapshot", snapshotStale: false },
    })
    expect(skipped).toBe("skipped")
    expect(setCalls).toBe(0)
  })
})
