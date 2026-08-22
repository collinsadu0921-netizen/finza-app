import {
  SERVICE_LIST_REMOUNT_TTL_MS,
  clearSharedJsonGet,
  invalidateSharedJsonGet,
  invalidateSharedJsonGetBusiness,
  resetSharedJsonGetForTests,
  setSharedJsonGetFetch,
  sharedJsonGet,
} from "@/lib/client/sharedJsonGet"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("sharedJsonGet", () => {
  beforeEach(() => {
    resetSharedJsonGetForTests()
  })

  it("coalesces concurrent identical GETs", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 15))
      return jsonResponse({ invoices: [1] })
    })
    const url = "/api/invoices/list?business_id=biz-a&page=1"
    const [a, b] = await Promise.all([sharedJsonGet(url), sharedJsonGet(url)])
    expect(calls).toBe(1)
    expect(a.json).toEqual({ invoices: [1] })
    expect(b.json).toEqual({ invoices: [1] })
  })

  it("does not coalesce different businesses or params", async () => {
    const seen: string[] = []
    setSharedJsonGetFetch(async (input) => {
      seen.push(String(input))
      return jsonResponse({ ok: true })
    })
    await Promise.all([
      sharedJsonGet("/api/invoices/list?business_id=biz-a&page=1"),
      sharedJsonGet("/api/invoices/list?business_id=biz-b&page=1"),
      sharedJsonGet("/api/invoices/list?business_id=biz-a&page=2"),
    ])
    expect(seen).toHaveLength(3)
  })

  it("absorbs a remount after the first GET completed (production pattern)", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ invoices: [calls] })
    })
    const url = "/api/invoices/list?business_id=biz-a&page=1"
    const first = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    const remount = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(calls).toBe(1)
    expect(remount.json).toEqual(first.json)
  })

  it("does not reuse a failed response", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      if (calls === 1) return jsonResponse({ error: "nope" }, 500)
      return jsonResponse({ invoices: ["ok"] })
    })
    const url = "/api/customers?business_id=biz-a"
    const first = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(first.ok).toBe(false)
    const second = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(calls).toBe(2)
    expect(second.ok).toBe(true)
  })

  it("fresh / invalidation still fetches after a remount hit", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ invoices: [calls] })
    })
    const url = "/api/bills/list?business_id=biz-a"
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    const refreshed = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS, fresh: true })
    expect(calls).toBe(2)
    expect(refreshed.json).toEqual({ invoices: [2] })
    invalidateSharedJsonGet("/api/bills/list")
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(calls).toBe(3)
  })

  it("does not share materials workspace responses across businesses", async () => {
    const seen: string[] = []
    setSharedJsonGetFetch(async () => {
      seen.push("net")
      return jsonResponse({ rows: seen.length })
    })
    const url = "/api/service/materials/workspace?page=1&limit=25"
    await Promise.all([
      sharedJsonGet(url, { cacheKey: `${url}::biz-a` }),
      sharedJsonGet(url, { cacheKey: `${url}::biz-b` }),
    ])
    expect(seen).toHaveLength(2)
    invalidateSharedJsonGetBusiness("biz-a")
    await sharedJsonGet(url, { cacheKey: `${url}::biz-a`, ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(seen).toHaveLength(3)
  })

  it("clearSharedJsonGet forces a new GET for the same key", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ n: calls })
    })
    const url = "/api/invoices/list?business_id=biz-a"
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    clearSharedJsonGet()
    const next = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(calls).toBe(2)
    expect(next.json).toEqual({ n: 2 })
  })

  it("does not let a pre-clear inflight response repopulate the store", async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      await gate
      return jsonResponse({ owner: calls === 1 ? "A" : "B" })
    })
    const url = "/api/invoices/list?business_id=biz-a"
    const pending = sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    clearSharedJsonGet()
    release?.()
    const stale = await pending
    expect(stale.json).toEqual({ owner: "A" })
    const after = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(calls).toBe(2)
    expect(after.json).toEqual({ owner: "B" })
  })

  it("after clear, remount dedup still works for the new session", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ n: calls })
    })
    const url = "/api/customers?business_id=biz-a"
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    clearSharedJsonGet()
    const first = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    const remount = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(calls).toBe(2)
    expect(remount.json).toEqual(first.json)
  })
})
