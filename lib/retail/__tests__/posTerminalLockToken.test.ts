import {
  signPosTerminalLockToken,
  verifyPosTerminalLockToken,
  isApiBlockedByPosTerminalLock,
  isPageAllowedWithPosTerminalLock,
} from "../posTerminalLockToken"

describe("posTerminalLockToken", () => {
  const prev = process.env.CASHIER_POS_TOKEN_SECRET

  beforeEach(() => {
    process.env.CASHIER_POS_TOKEN_SECRET = "unit-test-secret-at-least-16"
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.CASHIER_POS_TOKEN_SECRET
    else process.env.CASHIER_POS_TOKEN_SECRET = prev
  })

  it("signs and verifies a terminal lock token", async () => {
    const t = await signPosTerminalLockToken({
      businessId: "biz-1",
      storeId: "store-1",
      registerId: "reg-1",
    })
    expect(t).toMatch(/^tl1\./)
    const claims = await verifyPosTerminalLockToken(t!)
    expect(claims?.businessId).toBe("biz-1")
    expect(claims?.storeId).toBe("store-1")
    expect(claims?.registerId).toBe("reg-1")
  })

  it("rejects tampered tokens", async () => {
    const t = await signPosTerminalLockToken({
      businessId: "biz-1",
      storeId: "store-1",
    })
    expect(await verifyPosTerminalLockToken(t!.replace(/.$/, "x"))).toBeNull()
  })

  it("blocks privileged APIs while allowing cashier POS APIs", () => {
    expect(isApiBlockedByPosTerminalLock("/api/retail/pos/bootstrap", "GET")).toBe(false)
    expect(isApiBlockedByPosTerminalLock("/api/retail/pos/sales", "POST")).toBe(false)
    expect(isApiBlockedByPosTerminalLock("/api/retail/pos/terminal-lock", "POST")).toBe(false)
    expect(
      isApiBlockedByPosTerminalLock("/api/retail/registers/reg-1/customer-display", "GET")
    ).toBe(false)
    expect(
      isApiBlockedByPosTerminalLock("/api/retail/registers/reg-1/customer-display", "PUT")
    ).toBe(true)
    expect(isApiBlockedByPosTerminalLock("/api/customers", "GET")).toBe(true)
    expect(isApiBlockedByPosTerminalLock("/api/sales/park", "POST")).toBe(true)
    expect(isApiBlockedByPosTerminalLock("/api/sales-history/list", "GET")).toBe(true)
    expect(isApiBlockedByPosTerminalLock("/api/retail/admin/staff", "GET")).toBe(true)
  })

  it("allows POS pages and blocks admin pages under lock", () => {
    expect(isPageAllowedWithPosTerminalLock("/retail/pos")).toBe(true)
    expect(isPageAllowedWithPosTerminalLock("/retail/pos/pin")).toBe(true)
    expect(isPageAllowedWithPosTerminalLock("/retail/admin/registers")).toBe(false)
    expect(isPageAllowedWithPosTerminalLock("/retail/dashboard")).toBe(false)
    expect(isPageAllowedWithPosTerminalLock("/login")).toBe(true)
  })
})
