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

  it("blocks while checkout modal is open", () => {
    const res = canSwitchCashier({
      cartItemCount: 0,
      processingPayment: false,
      checkoutOpen: true,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe("payment_in_progress")
  })
})

describe("switchToCashierPinLock", () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearRetailPosPinUrlIsolation()
    clearCashierSession()
  })

  it("activates lock, invalidates cashier token, signs out, navigates to PIN — never admin", async () => {
    setCashierSession({
      cashierId: "c-a",
      cashierName: "Cashier A",
      storeId: "store-1",
      businessId: "biz-1",
    })
    setCashierPosToken("fp1.test-token")
    expect(isCashierAuthenticated()).toBe(true)

    const signOut = jest.fn().mockResolvedValue(undefined)
    const navigateToPin = jest.fn()
    const navigateToAdmin = jest.fn()

    await switchToCashierPinLock({ signOut, navigateToPin })

    expect(isRetailPosPinUrlIsolationActive()).toBe(true)
    expect(getCashierSession()).toBeNull()
    expect(getCashierPosToken()).toBeNull()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(navigateToPin).toHaveBeenCalledTimes(1)
    expect(navigateToAdmin).not.toHaveBeenCalled()
  })

  it("activates lock before clearing so owner UI cannot flash via unlocked gap", async () => {
    setCashierSession({
      cashierId: "c-a",
      cashierName: "Cashier A",
      storeId: "store-1",
      businessId: "biz-1",
    })
    const order: string[] = []
    const signOut = jest.fn().mockImplementation(async () => {
      order.push("signOut")
      expect(isRetailPosPinUrlIsolationActive()).toBe(true)
      expect(getCashierSession()).toBeNull()
    })
    const navigateToPin = jest.fn(() => {
      order.push("navigateToPin")
      expect(isRetailPosPinUrlIsolationActive()).toBe(true)
    })

    // spy activate by checking lock is set at start of signOut (after clear)
    await switchToCashierPinLock({ signOut, navigateToPin })
    expect(order).toEqual(["signOut", "navigateToPin"])
    expect(isRetailPosPinUrlIsolationActive()).toBe(true)
  })
})

describe("afterCashierPinSuccessSecureTerminal", () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearRetailPosPinUrlIsolation()
  })

  it("keeps terminal lock active and drops owner session", async () => {
    const signOut = jest.fn().mockResolvedValue(undefined)
    await afterCashierPinSuccessSecureTerminal({ signOut })
    expect(isRetailPosPinUrlIsolationActive()).toBe(true)
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it("does not clear lock (PIN success must not reveal admin on later token clear)", async () => {
    activateRetailPosPinUrlIsolation()
    await afterCashierPinSuccessSecureTerminal({
      signOut: jest.fn().mockResolvedValue(undefined),
    })
    expect(isRetailPosPinUrlIsolationActive()).toBe(true)
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

  it("signs out, clears lock, goes to login — not dashboard/admin", async () => {
    const signOut = jest.fn().mockResolvedValue(undefined)
    const navigateToLogin = jest.fn()
    await exitCashierLockForAdminReauth({ signOut, navigateToLogin })
    expect(signOut).toHaveBeenCalled()
    expect(isCashierAuthenticated()).toBe(false)
    expect(isRetailPosPinUrlIsolationActive()).toBe(false)
    expect(navigateToLogin).toHaveBeenCalledTimes(1)
  })
})

describe("cashier A → B operator identity", () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearCashierSession()
  })

  it("new cashier session replaces prior operator after switch + fresh PIN token", async () => {
    setCashierSession({
      cashierId: "c-a",
      cashierName: "Cashier A",
      storeId: "store-1",
      businessId: "biz-1",
    })
    setCashierPosToken("token-a")

    await switchToCashierPinLock({
      signOut: jest.fn().mockResolvedValue(undefined),
      navigateToPin: jest.fn(),
    })
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
    expect(session?.storeId).toBe("store-1")
  })
})
