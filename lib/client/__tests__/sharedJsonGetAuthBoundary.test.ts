import { readFileSync } from "fs"
import { resolve } from "path"
import {
  SERVICE_LIST_REMOUNT_TTL_MS,
  resetSharedJsonGetForTests,
  setSharedJsonGetFetch,
  sharedJsonGet,
} from "@/lib/client/sharedJsonGet"
import {
  beginSharedJsonGetAuthLogout,
  resetSharedJsonGetAuthBoundaryForTests,
  syncSharedJsonGetAuthIdentity,
} from "@/lib/client/sharedJsonGetAuthBoundary"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("sharedJsonGet auth boundary", () => {
  beforeEach(() => {
    resetSharedJsonGetForTests()
    resetSharedJsonGetAuthBoundaryForTests()
  })

  it("does not clear on initial hydration undefined → A", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ n: calls })
    })
    const url = "/api/invoices/list?business_id=biz-a"
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    const result = syncSharedJsonGetAuthIdentity("user-a")
    expect(result.cleared).toBe(false)
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(calls).toBe(1)
  })

  it("does not clear on A → A", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ n: calls })
    })
    const url = "/api/invoices/list?business_id=biz-a"
    syncSharedJsonGetAuthIdentity("user-a")
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(syncSharedJsonGetAuthIdentity("user-a").cleared).toBe(false)
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(calls).toBe(1)
  })

  it("clears on A → null", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ n: calls })
    })
    const url = "/api/invoices/list?business_id=biz-a"
    syncSharedJsonGetAuthIdentity("user-a")
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(syncSharedJsonGetAuthIdentity(null).cleared).toBe(true)
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(calls).toBe(2)
  })

  it("clears on A → B so B cannot reuse A", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ owner: calls === 1 ? "A" : "B" })
    })
    const url = "/api/invoices/list?business_id=biz-a"
    syncSharedJsonGetAuthIdentity("user-a")
    const a = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(a.json).toEqual({ owner: "A" })
    expect(syncSharedJsonGetAuthIdentity("user-b").cleared).toBe(true)
    const b = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(calls).toBe(2)
    expect(b.json).toEqual({ owner: "B" })
  })

  it("logout always clears even before identity hydration", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ n: calls })
    })
    const url = "/api/service/walkthrough/progress?business_id=biz-a"
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    beginSharedJsonGetAuthLogout()
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(calls).toBe(2)
  })

  it("after A→B remount dedup still works for B", async () => {
    let calls = 0
    setSharedJsonGetFetch(async () => {
      calls += 1
      return jsonResponse({ n: calls })
    })
    const url = "/api/expenses/list?business_id=biz-a"
    syncSharedJsonGetAuthIdentity("user-a")
    await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    syncSharedJsonGetAuthIdentity("user-b")
    const first = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    const remount = await sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS })
    expect(calls).toBe(2)
    expect(remount.json).toEqual(first.json)
  })

  it("wires every SPA logout path to beginSharedJsonGetAuthLogout before signOut", () => {
    const files = [
      "components/Sidebar.tsx",
      "components/AppIdleTimeoutWatcher.tsx",
      "app/select-workspace/page.tsx",
      "components/accounting/WorkspaceSidebar.tsx",
    ]
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8")
      expect(src).toContain("beginSharedJsonGetAuthLogout")
      expect(src.indexOf("beginSharedJsonGetAuthLogout")).toBeLessThan(src.indexOf("signOut("))
    }
  })
})
