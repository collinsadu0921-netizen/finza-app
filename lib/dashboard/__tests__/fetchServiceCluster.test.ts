import {
  SERVICE_LIST_REMOUNT_TTL_MS,
  resetSharedJsonGetForTests,
  setSharedJsonGetFetch,
} from "@/lib/client/sharedJsonGet"
import {
  buildServiceClusterUrl,
  fetchServiceClusterJson,
  serviceClusterCacheKey,
} from "@/lib/dashboard/fetchServiceCluster"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("fetchServiceClusterJson", () => {
  beforeEach(() => {
    resetSharedJsonGetForTests()
  })

  it("includes business and query identity in the cache key", () => {
    const url = buildServiceClusterUrl("biz-a")
    expect(url).toContain("business_id=biz-a")
    expect(serviceClusterCacheKey(url, "biz-a")).toBe(`${url}::biz-a`)
    expect(serviceClusterCacheKey(url, "biz-b")).not.toBe(serviceClusterCacheKey(url, "biz-a"))
  })

  it("does not issue a second identical remount GET", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ dashboard_ready: true })
    })
    const first = await fetchServiceClusterJson("biz-a")
    const remount = await fetchServiceClusterJson("biz-a")
    expect(calls).toBe(1)
    expect(remount.json).toEqual(first.json)
  })

  it("fetches again for a different business", async () => {
    const seen: string[] = []
    setSharedJsonGetFetch(async (input) => {
      seen.push(String(input))
      return jsonResponse({ dashboard_ready: true })
    })
    await fetchServiceClusterJson("biz-a")
    await fetchServiceClusterJson("biz-b")
    expect(seen).toHaveLength(2)
    expect(seen[0]).toContain("business_id=biz-a")
    expect(seen[1]).toContain("business_id=biz-b")
  })

  it("fresh refresh still hits the network", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ n: calls })
    })
    await fetchServiceClusterJson("biz-a")
    const refreshed = await fetchServiceClusterJson("biz-a", { fresh: true })
    expect(calls).toBe(2)
    expect(refreshed.json).toEqual({ n: 2 })
  })

  it("uses a new request when the period query changes", async () => {
    const seen: string[] = []
    setSharedJsonGetFetch(async (input) => {
      seen.push(String(input))
      return jsonResponse({ dashboard_ready: true })
    })
    await fetchServiceClusterJson("biz-a")
    await fetchServiceClusterJson("biz-a", { periodStart: "2026-08-01" })
    expect(seen).toHaveLength(2)
    expect(seen[1]).toContain("period_start=2026-08-01")
  })

  it("keeps remount TTL short", () => {
    expect(SERVICE_LIST_REMOUNT_TTL_MS).toBeLessThanOrEqual(2_500)
  })
})
