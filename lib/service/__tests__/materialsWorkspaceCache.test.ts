import {
  SERVICE_LIST_REMOUNT_TTL_MS,
  resetSharedJsonGetForTests,
  setSharedJsonGetFetch,
  sharedJsonGet,
} from "@/lib/client/sharedJsonGet"
import {
  buildMaterialsWorkspaceUrl,
  materialsWorkspaceCacheKey,
} from "@/lib/service/materialsWorkspaceCache"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("materialsWorkspaceCacheKey", () => {
  beforeEach(() => {
    resetSharedJsonGetForTests()
  })

  it("requires a business id for cache identity", () => {
    const url = buildMaterialsWorkspaceUrl({ page: 1, limit: 25 })
    expect(materialsWorkspaceCacheKey(url, undefined)).toBeNull()
    expect(materialsWorkspaceCacheKey(url, "")).toBeNull()
    expect(materialsWorkspaceCacheKey(url, "   ")).toBeNull()
    expect(materialsWorkspaceCacheKey(url, "biz-a")).toBe(`${url}::biz-a`)
  })

  it("does not create an undefined shared key", () => {
    const url = "/api/service/materials/workspace?page=1&limit=25"
    expect(materialsWorkspaceCacheKey(url, undefined)).toBeNull()
    expect(String(materialsWorkspaceCacheKey(url, undefined))).not.toContain("undefined")
  })

  it("does not share A and B materials", async () => {
    const url = buildMaterialsWorkspaceUrl({ page: 1, limit: 25 })
    const seen: string[] = []
    setSharedJsonGetFetch(async (input) => {
      seen.push(String(input))
      return jsonResponse({ rows: [String(input)] })
    })
    await sharedJsonGet(url, {
      ttlMs: SERVICE_LIST_REMOUNT_TTL_MS,
      cacheKey: materialsWorkspaceCacheKey(url, "biz-a") ?? url,
    })
    await sharedJsonGet(url, {
      ttlMs: SERVICE_LIST_REMOUNT_TTL_MS,
      cacheKey: materialsWorkspaceCacheKey(url, "biz-b") ?? url,
    })
    expect(seen).toHaveLength(2)
  })

  it("starts a request once an authoritative business id is available", async () => {
    const url = buildMaterialsWorkspaceUrl({ page: 1, limit: 25 })
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ rows: [] })
    })
    const blocked = materialsWorkspaceCacheKey(url, "")
    expect(blocked).toBeNull()
    const key = materialsWorkspaceCacheKey(url, "biz-a")
    expect(key).toBeTruthy()
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS, cacheKey: key! })
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS, cacheKey: key! })
    expect(calls).toBe(1)
  })
})
