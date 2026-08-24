import {
  resetSharedJsonGetForTests,
  setSharedJsonGetFetch,
} from "@/lib/client/sharedJsonGet"
import { fetchAccountingReportJson } from "@/lib/accounting/fetchAccountingReportJson"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("fetchAccountingReportJson", () => {
  beforeEach(() => {
    resetSharedJsonGetForTests()
  })

  it("P&L remount same business/date is one network request", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ totals: { net_profit: -6441 } })
    })
    const url = "/api/accounting/reports/profit-and-loss?business_id=biz-a"
    const first = await fetchAccountingReportJson(url)
    const remount = await fetchAccountingReportJson(url)
    expect(calls).toBe(1)
    expect(remount.json).toEqual(first.json)
  })

  it("P&L date change is a new request", async () => {
    const seen: string[] = []
    setSharedJsonGetFetch(async (input) => {
      seen.push(String(input))
      return jsonResponse({ totals: { net_profit: 0 } })
    })
    await fetchAccountingReportJson("/api/accounting/reports/profit-and-loss?business_id=biz-a")
    await fetchAccountingReportJson(
      "/api/accounting/reports/profit-and-loss?business_id=biz-a&period_start=2026-07-01"
    )
    expect(seen).toHaveLength(2)
  })

  it("P&L business change is a new request", async () => {
    const seen: string[] = []
    setSharedJsonGetFetch(async (input) => {
      seen.push(String(input))
      return jsonResponse({ totals: { net_profit: 0 } })
    })
    await fetchAccountingReportJson("/api/accounting/reports/profit-and-loss?business_id=biz-a")
    await fetchAccountingReportJson("/api/accounting/reports/profit-and-loss?business_id=biz-b")
    expect(seen).toHaveLength(2)
  })

  it("Balance Sheet remount same business/as-of is one network request", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ totals: { assets: 1, liabilities: 1, equity: 0, imbalance: 0 } })
    })
    const url = "/api/accounting/reports/balance-sheet?business_id=biz-a&as_of_date=2026-08-24"
    await fetchAccountingReportJson(url)
    await fetchAccountingReportJson(url)
    expect(calls).toBe(1)
  })

  it("Balance Sheet as-of change is a new request", async () => {
    const seen: string[] = []
    setSharedJsonGetFetch(async (input) => {
      seen.push(String(input))
      return jsonResponse({ totals: { assets: 1 } })
    })
    await fetchAccountingReportJson(
      "/api/accounting/reports/balance-sheet?business_id=biz-a&as_of_date=2026-08-24"
    )
    await fetchAccountingReportJson(
      "/api/accounting/reports/balance-sheet?business_id=biz-a&as_of_date=2026-07-31"
    )
    expect(seen).toHaveLength(2)
  })

  it("Balance Sheet business change is a new request", async () => {
    const seen: string[] = []
    setSharedJsonGetFetch(async (input) => {
      seen.push(String(input))
      return jsonResponse({ totals: { assets: 1 } })
    })
    await fetchAccountingReportJson(
      "/api/accounting/reports/balance-sheet?business_id=biz-a&as_of_date=2026-08-24"
    )
    await fetchAccountingReportJson(
      "/api/accounting/reports/balance-sheet?business_id=biz-b&as_of_date=2026-08-24"
    )
    expect(seen).toHaveLength(2)
  })
})
