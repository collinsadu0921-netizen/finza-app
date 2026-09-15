import {
  configsAreIsolatedByTerminal,
  customerDisplayTerminalConfigKey,
  defaultCustomerDisplayTerminalConfig,
  parseCustomerDisplayTerminalConfig,
  readCustomerDisplayTerminalConfig,
  resolveConnectSerialProfile,
  shouldAllowAutomaticCustomerDisplayUpdates,
  writeCustomerDisplayTerminalConfig,
  type CustomerDisplayTerminalIdentity,
} from "@/lib/retail/hardware/customerDisplayTerminalConfig"
import { resolveCustomerDisplayIntent } from "@/lib/retail/hardware/customerDisplayProtocol"
import { readFileSync } from "fs"
import { join } from "path"

const repoRoot = join(__dirname, "../../../..")

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
  }
}

describe("customer display per-terminal config", () => {
  const tillA: CustomerDisplayTerminalIdentity = {
    businessId: "biz-1",
    storeId: "store-1",
    registerId: "reg-aaaa-1111-2222-3333-444444444444",
  }
  const tillB: CustomerDisplayTerminalIdentity = {
    businessId: "biz-1",
    storeId: "store-1",
    registerId: "reg-bbbb-1111-2222-3333-444444444444",
  }

  it("isolates config keys per physical terminal (register)", () => {
    expect(configsAreIsolatedByTerminal(tillA, tillB)).toBe(true)
    expect(customerDisplayTerminalConfigKey(tillA)).not.toBe(customerDisplayTerminalConfigKey(tillB))
  })

  it("does not allow automatic updates until physically verified", () => {
    expect(shouldAllowAutomaticCustomerDisplayUpdates(null)).toBe(false)
    expect(
      shouldAllowAutomaticCustomerDisplayUpdates({
        ...defaultCustomerDisplayTerminalConfig(),
        profileId: "2400",
        physicallyVerified: false,
      })
    ).toBe(false)
    expect(
      shouldAllowAutomaticCustomerDisplayUpdates({
        ...defaultCustomerDisplayTerminalConfig(),
        profileId: "2400",
        physicallyVerified: true,
      })
    ).toBe(true)
  })

  it("persists candidate baud per terminal without sharing across tills", () => {
    const storage = memoryStorage()
    writeCustomerDisplayTerminalConfig(
      tillA,
      {
        profileId: "2400",
        physicallyVerified: false,
        verifiedAt: null,
        verifiedNote: null,
        updatedAt: "2026-09-15T12:00:00.000Z",
      },
      storage
    )
    writeCustomerDisplayTerminalConfig(
      tillB,
      {
        profileId: "9600",
        physicallyVerified: true,
        verifiedAt: "2026-09-15T12:00:00.000Z",
        verifiedNote: "other till",
        updatedAt: "2026-09-15T12:00:00.000Z",
      },
      storage
    )
    expect(readCustomerDisplayTerminalConfig(tillA, storage)?.profileId).toBe("2400")
    expect(readCustomerDisplayTerminalConfig(tillA, storage)?.physicallyVerified).toBe(false)
    expect(readCustomerDisplayTerminalConfig(tillB, storage)?.profileId).toBe("9600")
    expect(readCustomerDisplayTerminalConfig(tillB, storage)?.physicallyVerified).toBe(true)
  })

  it("connect profile uses terminal candidate baud, not a Retail-wide hardcode", () => {
    const profile = resolveConnectSerialProfile({
      profileId: "2400",
      physicallyVerified: false,
      verifiedAt: null,
      verifiedNote: null,
      updatedAt: "2026-09-15T12:00:00.000Z",
    })
    expect(profile?.baudRate).toBe(2400)
    expect(resolveConnectSerialProfile(null)).toBeNull()
  })

  it("rejects invalid stored payloads", () => {
    expect(parseCustomerDisplayTerminalConfig({ profileId: "9999" })).toBeNull()
    expect(parseCustomerDisplayTerminalConfig(null)).toBeNull()
  })
})

describe("automatic updates gate + diagnostics", () => {
  it("suppresses sale intents when profile is not verified", () => {
    expect(
      resolveCustomerDisplayIntent({
        status: "connected",
        cartCount: 2,
        runningTotal: 12,
        checkoutOpen: true,
        saleSuccess: null,
        autoUpdatesAllowed: false,
      })
    ).toEqual({ action: "none" })
  })

  it("fails closed when autoUpdatesAllowed is omitted", () => {
    expect(
      resolveCustomerDisplayIntent({
        status: "connected",
        cartCount: 2,
        runningTotal: 12,
        checkoutOpen: true,
        saleSuccess: null,
      })
    ).toEqual({ action: "none" })
  })

  it("still suppresses in diagnostic mode even if verified", () => {
    expect(
      resolveCustomerDisplayIntent({
        status: "connected",
        cartCount: 2,
        runningTotal: 12,
        checkoutOpen: true,
        saleSuccess: null,
        diagnosticMode: true,
        autoUpdatesAllowed: true,
      })
    ).toEqual({ action: "none" })
  })
})

describe("admin-only diagnostics remain gated in POS wiring", () => {
  it("owner/admin gate for diagnostics; cashiers get status only", () => {
    const page = readFileSync(join(repoRoot, "components/retail/pos/RetailPosPage.tsx"), "utf8")
    expect(page).toMatch(/canUseDiagnostics:\s*userRole === "owner" \|\| userRole === "admin"/)
    expect(page).toMatch(/terminalIdentity/)
    const bar = readFileSync(join(repoRoot, "components/retail/pos/RetailPosHardwareBar.tsx"), "utf8")
    expect(bar).toMatch(/Advanced diagnostics/)
    expect(bar).toMatch(/Mark physically verified/)
    expect(bar).not.toMatch(/Open drawer/i)
    expect(bar).not.toMatch(/pulseCashDrawer/)
  })
})
