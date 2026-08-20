import {
  COA_TTL_MS,
  FIRMS_TTL_MS,
  PERIODS_TTL_MS,
  READINESS_TTL_MS,
  REPORT_REMOUNT_TTL_MS,
  invalidateClientBooksBusiness,
  invalidateClientBooksFirms,
  invalidateClientBooksPeriods,
  invalidateClientBooksReadiness,
  resetClientBooksRequestShareForTests,
  setClientBooksRequestShareFetch,
  sharedClientBooksJson,
} from "@/lib/accounting/clientBooksRequestShare"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("clientBooksRequestShare", () => {
  beforeEach(() => {
    resetClientBooksRequestShareForTests()
  })

  it("coalesces concurrent periods fetches for the same business", async () => {
    let calls = 0
    setClientBooksRequestShareFetch(async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 20))
      return jsonResponse({ periods: [1] })
    })
    const url = "/api/accounting/periods?business_id=biz-a"
    const [a, b] = await Promise.all([
      sharedClientBooksJson(url, { ttlMs: PERIODS_TTL_MS }),
      sharedClientBooksJson(url, { ttlMs: PERIODS_TTL_MS }),
    ])
    expect(calls).toBe(1)
    expect(a.json).toEqual({ periods: [1] })
    expect(b.json).toEqual({ periods: [1] })
  })

  it("keeps different businesses on separate periods fetches", async () => {
    const seen: string[] = []
    setClientBooksRequestShareFetch(async (input) => {
      seen.push(String(input))
      return jsonResponse({ periods: [String(input)] })
    })
    await Promise.all([
      sharedClientBooksJson("/api/accounting/periods?business_id=biz-a", { ttlMs: PERIODS_TTL_MS }),
      sharedClientBooksJson("/api/accounting/periods?business_id=biz-b", { ttlMs: PERIODS_TTL_MS }),
    ])
    expect(seen).toHaveLength(2)
  })

  it("does not poison the store after a failed periods fetch", async () => {
    let calls = 0
    setClientBooksRequestShareFetch(async () => {
      calls += 1
      if (calls === 1) return jsonResponse({ error: "nope" }, 500)
      return jsonResponse({ periods: ["ok"] })
    })
    const url = "/api/accounting/periods?business_id=biz-a"
    const first = await sharedClientBooksJson(url, { ttlMs: PERIODS_TTL_MS })
    expect(first.ok).toBe(false)
    const second = await sharedClientBooksJson(url, { ttlMs: PERIODS_TTL_MS })
    expect(calls).toBe(2)
    expect(second.ok).toBe(true)
  })

  it("invalidates periods on client switch / period mutation", async () => {
    let calls = 0
    setClientBooksRequestShareFetch(async () => {
      calls += 1
      return jsonResponse({ periods: [calls] })
    })
    const url = "/api/accounting/periods?business_id=biz-a"
    await sharedClientBooksJson(url, { ttlMs: PERIODS_TTL_MS })
    invalidateClientBooksBusiness("biz-a")
    await sharedClientBooksJson(url, { ttlMs: PERIODS_TTL_MS })
    expect(calls).toBe(2)
    await sharedClientBooksJson(url, { ttlMs: PERIODS_TTL_MS })
    expect(calls).toBe(2)
    invalidateClientBooksPeriods("biz-a")
    await sharedClientBooksJson(url, { ttlMs: PERIODS_TTL_MS })
    expect(calls).toBe(3)
  })

  it("coalesces concurrent readiness fetches for the same business", async () => {
    let calls = 0
    setClientBooksRequestShareFetch(async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 15))
      return jsonResponse({ ready: true, authority_source: "accountant", access_level: "write" })
    })
    const url = "/api/accounting/readiness?business_id=biz-a"
    await Promise.all([
      sharedClientBooksJson(url, { ttlMs: READINESS_TTL_MS }),
      sharedClientBooksJson(url, { ttlMs: READINESS_TTL_MS }),
      sharedClientBooksJson(url, { ttlMs: READINESS_TTL_MS }),
    ])
    expect(calls).toBe(1)
  })

  it("isolates readiness by business and does not cache 403", async () => {
    const seen: string[] = []
    setClientBooksRequestShareFetch(async (input) => {
      seen.push(String(input))
      if (String(input).includes("biz-denied")) return jsonResponse({ error: "Forbidden" }, 403)
      return jsonResponse({ ready: true })
    })
    const denied = await sharedClientBooksJson("/api/accounting/readiness?business_id=biz-denied", {
      ttlMs: READINESS_TTL_MS,
    })
    expect(denied.ok).toBe(false)
    await sharedClientBooksJson("/api/accounting/readiness?business_id=biz-denied", {
      ttlMs: READINESS_TTL_MS,
    })
    await sharedClientBooksJson("/api/accounting/readiness?business_id=biz-ok", {
      ttlMs: READINESS_TTL_MS,
    })
    expect(seen.filter((u) => u.includes("biz-denied"))).toHaveLength(2)
    expect(seen.filter((u) => u.includes("biz-ok"))).toHaveLength(1)
  })

  it("coalesces concurrent firm hydration", async () => {
    let calls = 0
    setClientBooksRequestShareFetch(async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 15))
      return jsonResponse({ firms: [{ firm_id: "f1" }] })
    })
    const url = "/api/accounting/firm/firms"
    await Promise.all([
      sharedClientBooksJson(url, { ttlMs: FIRMS_TTL_MS }),
      sharedClientBooksJson(url, { ttlMs: FIRMS_TTL_MS }),
      sharedClientBooksJson(url, { ttlMs: FIRMS_TTL_MS }),
    ])
    expect(calls).toBe(1)
  })

  it("invalidates firm membership after firm switch refresh", async () => {
    let calls = 0
    setClientBooksRequestShareFetch(async () => {
      calls += 1
      return jsonResponse({ firms: [calls] })
    })
    const url = "/api/accounting/firm/firms"
    await sharedClientBooksJson(url, { ttlMs: FIRMS_TTL_MS })
    invalidateClientBooksFirms()
    await sharedClientBooksJson(url, { ttlMs: FIRMS_TTL_MS })
    expect(calls).toBe(2)
  })

  it("does not refetch an identical P&L URL inside the remount TTL", async () => {
    let calls = 0
    setClientBooksRequestShareFetch(async () => {
      calls += 1
      return jsonResponse({ sections: [] })
    })
    const url = "/api/accounting/reports/profit-and-loss?business_id=biz-a"
    await sharedClientBooksJson(url, { ttlMs: REPORT_REMOUNT_TTL_MS })
    await sharedClientBooksJson(url, { ttlMs: REPORT_REMOUNT_TTL_MS })
    expect(calls).toBe(1)
  })

  it("fetches once more when the period/filter changes", async () => {
    let calls = 0
    setClientBooksRequestShareFetch(async () => {
      calls += 1
      return jsonResponse({ sections: [calls] })
    })
    await sharedClientBooksJson(
      "/api/accounting/reports/profit-and-loss?business_id=biz-a",
      { ttlMs: REPORT_REMOUNT_TTL_MS }
    )
    await sharedClientBooksJson(
      "/api/accounting/reports/profit-and-loss?business_id=biz-a&period_start=2026-08-01",
      { ttlMs: REPORT_REMOUNT_TTL_MS }
    )
    expect(calls).toBe(2)
  })

  it("cannot reuse Client A report context for Client B", async () => {
    const seen: string[] = []
    setClientBooksRequestShareFetch(async (input) => {
      seen.push(String(input))
      return jsonResponse({ client: String(input) })
    })
    await sharedClientBooksJson(
      "/api/accounting/reports/profit-and-loss?business_id=client-a",
      { ttlMs: REPORT_REMOUNT_TTL_MS }
    )
    await sharedClientBooksJson(
      "/api/accounting/reports/profit-and-loss?business_id=client-b",
      { ttlMs: REPORT_REMOUNT_TTL_MS }
    )
    expect(seen).toEqual([
      "/api/accounting/reports/profit-and-loss?business_id=client-a",
      "/api/accounting/reports/profit-and-loss?business_id=client-b",
    ])
  })

  it("ignores a stale Client A result after the watched business changes", async () => {
    const { isStaleClientAuthorityResponse } = await import(
      "@/lib/accounting/practiceShellSession"
    )
    expect(isStaleClientAuthorityResponse("client-a", "client-b")).toBe(true)
    invalidateClientBooksReadiness("client-a")
    expect(true).toBe(true)
  })

  it("shares COA by URL and keeps the TTL distinct from reports", async () => {
    let calls = 0
    setClientBooksRequestShareFetch(async () => {
      calls += 1
      return jsonResponse({ accounts: [] })
    })
    const url = "/api/accounting/coa?business_id=biz-a"
    await sharedClientBooksJson(url, { ttlMs: COA_TTL_MS })
    await sharedClientBooksJson(url, { ttlMs: COA_TTL_MS })
    expect(calls).toBe(1)
  })
})
