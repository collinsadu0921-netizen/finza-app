import { readFileSync } from "fs"
import { join } from "path"

const root = join(__dirname, "..", "..", "..")

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8")
}

describe("Switch cashier security wiring (source)", () => {
  it("RetailPosPage Switch uses lock helper and does not clear session alone", () => {
    const src = read("components/retail/pos/RetailPosPage.tsx")
    expect(src).toContain("switchToCashierPinLock")
    expect(src).toContain("canSwitchCashier")
    expect(src).not.toMatch(
      /handleEndCashierPinSession\s*=\s*\(\)\s*=>\s*\{\s*clearCashierSession\(\)/
    )
  })

  it("PIN success keeps terminal lock (does not clear isolation)", () => {
    const src = read("components/retail/pos/RetailPosPinPage.tsx")
    expect(src).toContain("afterCashierPinSuccessSecureTerminal")
    expect(src).not.toContain("clearRetailPosPinUrlIsolation()")
    expect(src).toContain("exitCashierLockForAdminReauth")
    expect(src).toContain("Admin access")
  })

  it("accessControl STEP 8.5 has no owner/admin/manager bypass", () => {
    const src = read("lib/accessControl.ts")
    expect(src).toContain("STEP 8.5")
    expect(src).not.toMatch(/privilegedRetailBackoffice/)
    expect(src).not.toMatch(
      /role === "owner" \|\| role === "admin" \|\| role === "manager"[\s\S]{0,120}isPinCashierRetailAllowedPath/
    )
  })

  it("does not disconnect customer-display on switch (no COM hardcode in lock helper)", () => {
    const lock = read("lib/retail/cashierTerminalLock.ts")
    expect(lock).not.toMatch(/disconnect|COM2|baud|serial/i)
    expect(lock).toContain("activateRetailPosPinUrlIsolation")
    expect(lock).toContain("signOut")
  })
})
