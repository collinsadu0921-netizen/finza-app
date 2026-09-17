import { readFileSync } from "fs"
import { join } from "path"

const root = join(__dirname, "..", "..", "..")

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8")
}

describe("Switch cashier security wiring (Option B)", () => {
  it("does not sign out manager on Switch or PIN success", () => {
    const lock = read("lib/retail/cashierTerminalLock.ts")
    expect(lock).toContain("switchToCashierPinLock")
    expect(lock).not.toMatch(/signOut/)
    expect(lock).toContain("activatePosTerminalLockCookie")
    expect(lock).toContain("exitCashierLockForAdminReauth")
  })

  it("RetailPosPage Switch uses lock helper without signOut", () => {
    const src = read("components/retail/pos/RetailPosPage.tsx")
    expect(src).toContain("switchToCashierPinLock")
    expect(src).toContain("canSwitchCashier")
    expect(src).not.toMatch(/switchToCashierPinLock\(\{[\s\S]*signOut/)
  })

  it("PIN Admin access requires email/password reauth API", () => {
    const src = read("components/retail/pos/RetailPosPinPage.tsx")
    expect(src).toContain("exitCashierLockForAdminReauth")
    expect(src).toContain("Admin reauthentication")
    expect(src).not.toContain("navigateToLogin")
  })

  it("middleware enforces terminal lock cookie on privileged paths", () => {
    const src = read("middleware.ts")
    expect(src).toContain("readPosTerminalLockClaimsFromRequest")
    expect(src).toContain("isApiBlockedByPosTerminalLock")
    expect(src).toContain("pos_terminal_locked")
  })

  it("accessControl STEP 8.5 has no owner/admin/manager bypass", () => {
    const src = read("lib/accessControl.ts")
    expect(src).toContain("STEP 8.5")
    expect(src).not.toMatch(/privilegedRetailBackoffice/)
  })

  it("does not disconnect customer-display on switch", () => {
    const lock = read("lib/retail/cashierTerminalLock.ts")
    expect(lock).not.toMatch(/disconnect|COM2|baud|serial/i)
  })
})
