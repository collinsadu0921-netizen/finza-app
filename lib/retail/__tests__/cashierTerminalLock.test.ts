/**
 * @jest-environment jsdom
 */

import {
  canSwitchCashier,
  switchToCashierPinLock,
  afterCashierPinSuccessSecureTerminal,
  exitCashierLockForAdminReauth,
} from "../cashierTerminalLock"
import {
  activateRetailPosPinUrlIsolation,
  clearRetailPosPinUrlIsolation,
  isRetailPosPinUrlIsolationActive,
} from "../posPinUrlIsolation"
import {
  setCashierSession,
  setCashierPosToken,
  clearCashierSession,
  getCashierSession,
  getCashierPosToken,
  isCashierAuthenticated,
} from "@/lib/cashierSession"

describe("canSwitchCashier", () => {
  it("allows empty basket with no payment in progress", () => {
    expect(
      canSwitchCashier({ cartItemCount: 0, processingPayment: false, checkoutOpen: false })
    ).toEqual({ ok: true })
  })

  it("blocks non-empty basket without inventing park/attribution", () => {
    const res = canSwitchCashier({
      cartItemCount: 2,
      processingPayment: false,
      checkoutOpen: false,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe("non_empty_cart")
  })

  it("blocks while payment is submitting", () => {
    const res = canSwitchCashier({
      cartItemCount: 0,
      processingPayment: true,
      checkoutOpen: false,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe("payment_in_progress")
  })
})

describe("switchToCashierPinLock (Option B — no manager signOut)", () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearRetailPosPinUrlIsolation()
    clearCashierSession()
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
  })

  it("activates lock isolation, clears cashier token, navigates to PIN — does not call signOut", async () => {
    setCashierSession({
      cashierId: "c-a",
      cashierName: "Cashier A",
      storeId: "store-1",
      businessId: "biz-1",
    })
    setCashierPosToken("fp1.test-token")
    const navigateToPin = jest.fn()

    await switchToCashierPinLock({
      navigateToPin,
      refreshLock: { businessId: "biz-1", storeId: "store-1", registerId: "reg-1" },
    })

    expect(isRetailPosPinUrlIsolationActive()).toBe(true)
    expect(getCashierSession()).toBeNull()
    expect(getCashierPosToken()).toBeNull()
    expect(navigateToPin).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/retail/pos/terminal-lock",
      expect.objectContaining({ method: "POST" })
    )
  })
})

describe("afterCashierPinSuccessSecureTerminal", () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearRetailPosPinUrlIsolation()
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
  })

  it("keeps client isolation and activates server terminal lock without signOut", async () => {
    await afterCashierPinSuccessSecureTerminal({
      lock: { businessId: "biz-1", storeId: "store-1", registerId: "reg-1" },
    })
    expect(isRetailPosPinUrlIsolationActive()).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/retail/pos/terminal-lock",
      expect.objectContaining({ method: "POST" })
    )
  })
})

describe("exitCashierLockForAdminReauth", () => {
  beforeEach(() => {
    sessionStorage.clear()
    activateRetailPosPinUrlIsolation()
    setCashierSession({
      cashierId: "c-a",
      cashierName: "Cashier A",
      storeId: "store-1",
      businessId: "biz-1",
    })
  })

  it("clears lock only after successful reauth API", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch
    const navigateToAdmin = jest.fn()
    const result = await exitCashierLockForAdminReauth({
      email: "owner@example.com",
      password: "secret",
      navigateToAdmin,
    })
    expect(result).toEqual({ ok: true })
    expect(isCashierAuthenticated()).toBe(false)
    expect(isRetailPosPinUrlIsolationActive()).toBe(false)
    expect(navigateToAdmin).toHaveBeenCalledTimes(1)
  })

  it("remains locked on failed reauth", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Invalid email or password" }),
    }) as unknown as typeof fetch
    const navigateToAdmin = jest.fn()
    const result = await exitCashierLockForAdminReauth({
      email: "owner@example.com",
      password: "wrong",
      navigateToAdmin,
    })
    expect(result.ok).toBe(false)
    expect(isRetailPosPinUrlIsolationActive()).toBe(true)
    expect(navigateToAdmin).not.toHaveBeenCalled()
  })
})

describe("cashier A → B operator identity", () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearCashierSession()
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
  })

  it("new cashier session replaces prior operator after switch + fresh PIN token", async () => {
    setCashierSession({
      cashierId: "c-a",
      cashierName: "Cashier A",
      storeId: "store-1",
      businessId: "biz-1",
    })
    setCashierPosToken("token-a")

    await switchToCashierPinLock({ navigateToPin: jest.fn() })
    expect(getCashierPosToken()).toBeNull()

    setCashierSession({
      cashierId: "c-b",
      cashierName: "Cashier B",
      storeId: "store-1",
      businessId: "biz-1",
    })
    setCashierPosToken("token-b")

    const session = getCashierSession()
    expect(session?.cashierId).toBe("c-b")
    expect(session?.cashierName).toBe("Cashier B")
    expect(getCashierPosToken()).toBe("token-b")
  })
})
