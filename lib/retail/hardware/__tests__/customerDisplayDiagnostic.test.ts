jest.mock("@/lib/retail/hardware/webSerialPort", () => {
  const actual = jest.requireActual("@/lib/retail/hardware/webSerialPort") as Record<string, unknown>
  return {
    ...actual,
    listGrantedSerialPorts: jest.fn(),
    requestSerialPort: jest.fn(),
    openSerialPort: jest.fn(),
    writeSerialBytes: jest.fn(),
    closeSerialPort: jest.fn(),
  }
})

import {
  CUSTOMER_DISPLAY_DIAGNOSTIC_DEFAULT_PROFILE_ID,
  CUSTOMER_DISPLAY_DIAGNOSTIC_TESTS,
  CUSTOMER_DISPLAY_SERIAL_PROFILES,
  appendCustomerDisplayDiagnosticLog,
  asciiToDiagnosticBytes,
  buildCandidateClearThenAmountPreview,
  buildCustomerDisplayDiagnosticBytes,
  bytesToHexPreview,
  getCustomerDisplaySerialProfile,
  parseDiagnosticAmountAscii,
  shouldSuppressAutoCustomerDisplayWrites,
} from "@/lib/retail/hardware/customerDisplayDiagnostic"
import { resolveCustomerDisplayIntent } from "@/lib/retail/hardware/customerDisplayProtocol"
import {
  __resetCustomerDisplaySessionForTests,
  connectCustomerDisplay,
  getCustomerDisplayDiagnosticWriteCount,
  isCustomerDisplayDiagnosticMode,
  setAutomaticCustomerDisplaySaleWritesEnabled,
  setCustomerDisplayDiagnosticMode,
  writeCustomerDisplayAmount,
  writeCustomerDisplayDiagnosticClearThenAmount,
  writeCustomerDisplayDiagnosticTest,
} from "@/lib/retail/hardware/retailPosHardware"
import {
  closeSerialPort,
  listGrantedSerialPorts,
  openSerialPort,
  writeSerialBytes,
} from "@/lib/retail/hardware/webSerialPort"
import { readFileSync } from "fs"
import { join } from "path"

const repoRoot = join(__dirname, "../../../..")

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8")
}

const listGrantedSerialPortsMock = listGrantedSerialPorts as jest.MockedFunction<typeof listGrantedSerialPorts>
const openSerialPortMock = openSerialPort as jest.MockedFunction<typeof openSerialPort>
const writeSerialBytesMock = writeSerialBytes as jest.MockedFunction<typeof writeSerialBytes>
const closeSerialPortMock = closeSerialPort as jest.MockedFunction<typeof closeSerialPort>

function fakePort() {
  return {
    open: async () => undefined,
    writable: {} as WritableStream<Uint8Array>,
    close: async () => undefined,
  }
}

describe("customer display diagnostic serial profiles", () => {
  it("exposes every selectable serial profile as 8N1 with no flow control", () => {
    expect(CUSTOMER_DISPLAY_SERIAL_PROFILES.map((p) => p.baudRate)).toEqual([2400, 4800, 9600, 19200])
    for (const profile of CUSTOMER_DISPLAY_SERIAL_PROFILES) {
      expect(profile.dataBits).toBe(8)
      expect(profile.stopBits).toBe(1)
      expect(profile.parity).toBe("none")
      expect(profile.flowControl).toBe("none")
    }
    expect(CUSTOMER_DISPLAY_DIAGNOSTIC_DEFAULT_PROFILE_ID).toBe("2400")
    expect(getCustomerDisplaySerialProfile("2400").baudRate).toBe(2400)
  })
})

describe("customer display diagnostic payloads", () => {
  it("builds exact ASCII test payload bytes", () => {
    expect(Array.from(buildCustomerDisplayDiagnosticBytes("ascii_0_00"))).toEqual([0x30, 0x2e, 0x30, 0x30])
    expect(Array.from(buildCustomerDisplayDiagnosticBytes("ascii_1234_56"))).toEqual([
      0x31, 0x32, 0x33, 0x34, 0x2e, 0x35, 0x36,
    ])
    expect(Array.from(buildCustomerDisplayDiagnosticBytes("spaces8_then_0_00"))).toEqual([
      0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x30, 0x2e, 0x30, 0x30,
    ])
    expect(Array.from(buildCustomerDisplayDiagnosticBytes("ascii_eight_zeroes"))).toEqual([
      0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30,
    ])
    expect(CUSTOMER_DISPLAY_DIAGNOSTIC_TESTS.filter((t) => t.id !== "candidate_clear_0c")).toHaveLength(4)
  })

  it("builds exactly one candidate-clear byte 0C with no companions", () => {
    const bytes = buildCustomerDisplayDiagnosticBytes("candidate_clear_0c")
    expect(Array.from(bytes)).toEqual([0x0c])
    expect(bytesToHexPreview(bytes)).toBe("0C")
    expect(bytes.length).toBe(1)
    expect(Array.from(bytes)).not.toContain(0x1b)
    expect(Array.from(bytes)).not.toContain(0x0d)
    expect(Array.from(bytes)).not.toContain(0x0a)
    const probe = CUSTOMER_DISPLAY_DIAGNOSTIC_TESTS.find((t) => t.id === "candidate_clear_0c")
    expect(probe?.name).toBe("Test candidate clear (0C)")
    expect(probe?.warning).toMatch(/Unverified for this display/)
  })

  it("validates clear-then-amount ASCII and previews 0C then amount bytes", () => {
    expect(parseDiagnosticAmountAscii("1234.56")).toEqual({ ok: true, ascii: "1234.56" })
    expect(parseDiagnosticAmountAscii("0.00")).toEqual({ ok: true, ascii: "0.00" })
    expect(parseDiagnosticAmountAscii("12.3.4").ok).toBe(false)
    expect(parseDiagnosticAmountAscii("abc").ok).toBe(false)
    expect(parseDiagnosticAmountAscii("123456789").ok).toBe(false)
    const preview = buildCandidateClearThenAmountPreview("1234.56")
    expect(preview.valid).toBe(true)
    expect(preview.clearHex).toBe("0C")
    expect(preview.amountHex).toBe("31 32 33 34 2E 35 36")
    expect(Array.from(preview.clearBytes)).toEqual([0x0c])
    expect(Array.from(preview.amountBytes!)).toEqual([0x31, 0x32, 0x33, 0x34, 0x2e, 0x35, 0x36])
  })

  it("shows hex preview of ASCII outgoing bytes without adding CR/LF/ESC/0C", () => {
    expect(bytesToHexPreview(asciiToDiagnosticBytes("0.00"))).toBe("30 2E 30 30")
    const bytes = buildCustomerDisplayDiagnosticBytes("ascii_0_00")
    expect(Array.from(bytes)).not.toContain(0x1b)
    expect(Array.from(bytes)).not.toContain(0x0d)
    expect(Array.from(bytes)).not.toContain(0x0a)
    expect(Array.from(bytes)).not.toContain(0x0c)
  })
})

describe("customer display diagnostic write behaviour", () => {
  beforeEach(() => {
    __resetCustomerDisplaySessionForTests()
    listGrantedSerialPortsMock.mockReset()
    openSerialPortMock.mockReset()
    writeSerialBytesMock.mockReset()
    closeSerialPortMock.mockReset()
    listGrantedSerialPortsMock.mockResolvedValue([fakePort()])
    openSerialPortMock.mockResolvedValue(undefined)
    writeSerialBytesMock.mockResolvedValue(undefined)
    closeSerialPortMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    __resetCustomerDisplaySessionForTests()
  })

  it("does not write on connection", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: true,
    })
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
    expect(getCustomerDisplayDiagnosticWriteCount()).toBe(0)
  })

  it("enters diagnostic mode while disconnected (Enter diagnostic must not no-op)", async () => {
    expect(isCustomerDisplayDiagnosticMode()).toBe(false)
    await setCustomerDisplayDiagnosticMode(true)
    expect(isCustomerDisplayDiagnosticMode()).toBe(true)
    // refresh()-style read must keep the preference without an open COM session
    expect(isCustomerDisplayDiagnosticMode()).toBe(true)
    await setCustomerDisplayDiagnosticMode(false)
    expect(isCustomerDisplayDiagnosticMode()).toBe(false)
  })

  it("keeps diagnostic mode across connect after Enter diagnostic while off", async () => {
    await setCustomerDisplayDiagnosticMode(true)
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: true,
    })
    expect(isCustomerDisplayDiagnosticMode()).toBe(true)
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
  })

  it("performs exactly one write per diagnostic button press", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: true,
    })
    const storage = memoryStorage()
    await writeCustomerDisplayDiagnosticTest("ascii_0_00", { storage })
    await writeCustomerDisplayDiagnosticTest("ascii_1234_56", { storage })
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(2)
    expect(getCustomerDisplayDiagnosticWriteCount()).toBe(2)
    expect(Array.from(writeSerialBytesMock.mock.calls[0][1])).toEqual([0x30, 0x2e, 0x30, 0x30])
  })

  it("sends exactly one 0C byte on one candidate-clear press when connected in diagnostic mode", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: true,
    })
    const storage = memoryStorage()
    const result = await writeCustomerDisplayDiagnosticTest("candidate_clear_0c", { storage })
    expect(result.ok).toBe(true)
    expect(result.bytesHex).toBe("0C")
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(1)
    expect(Array.from(writeSerialBytesMock.mock.calls[0][1])).toEqual([0x0c])
    expect(getCustomerDisplayDiagnosticWriteCount()).toBe(1)
    const parsed = JSON.parse(storage.getItem("finza.retail.customerDisplay.diagnosticLog") || "[]")
    expect(parsed[0]).toMatchObject({
      baudRate: 2400,
      testName: "Test candidate clear (0C)",
      testId: "candidate_clear_0c",
      bytesHex: "0C",
      ok: true,
      error: null,
    })
  })

  it("runs clear-then-amount as 0C then amount ASCII, logging both writes", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: true,
    })
    const storage = memoryStorage()
    const result = await writeCustomerDisplayDiagnosticClearThenAmount("1234.56", { storage })
    expect(result.clear.ok).toBe(true)
    expect(result.clear.bytesHex).toBe("0C")
    expect(result.amount?.ok).toBe(true)
    expect(result.amount?.bytesHex).toBe("31 32 33 34 2E 35 36")
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(2)
    expect(Array.from(writeSerialBytesMock.mock.calls[0][1])).toEqual([0x0c])
    expect(Array.from(writeSerialBytesMock.mock.calls[1][1])).toEqual([
      0x31, 0x32, 0x33, 0x34, 0x2e, 0x35, 0x36,
    ])
    expect(getCustomerDisplayDiagnosticWriteCount()).toBe(2)
    const parsed = JSON.parse(storage.getItem("finza.retail.customerDisplay.diagnosticLog") || "[]")
    expect(parsed[0]).toMatchObject({
      testId: "candidate_amount_ascii",
      bytesHex: "31 32 33 34 2E 35 36",
      ok: true,
    })
    expect(parsed[1]).toMatchObject({
      testId: "candidate_clear_0c",
      bytesHex: "0C",
      ok: true,
    })
  })

  it("stops clear-then-amount if the clear write fails", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: true,
    })
    writeSerialBytesMock.mockRejectedValueOnce(new Error("port closed"))
    const storage = memoryStorage()
    const result = await writeCustomerDisplayDiagnosticClearThenAmount("12.00", { storage })
    expect(result.clear.ok).toBe(false)
    expect(result.amount).toBeNull()
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(1)
    expect(Array.from(writeSerialBytesMock.mock.calls[0][1])).toEqual([0x0c])
  })

  it("rejects clear-then-amount without a connected port or valid amount", async () => {
    const storage = memoryStorage()
    const disconnected = await writeCustomerDisplayDiagnosticClearThenAmount("12.00", { storage })
    expect(disconnected.clear.ok).toBe(false)
    expect(disconnected.amount).toBeNull()
    expect(writeSerialBytesMock).not.toHaveBeenCalled()

    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: true,
    })
    const invalid = await writeCustomerDisplayDiagnosticClearThenAmount("12.3.4", { storage })
    expect(invalid.clear.ok).toBe(false)
    expect(invalid.amount).toBeNull()
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
  })

  it("does not send candidate clear when the display is disconnected", async () => {
    const storage = memoryStorage()
    const result = await writeCustomerDisplayDiagnosticTest("candidate_clear_0c", { storage })
    expect(result.ok).toBe(false)
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
    expect(getCustomerDisplayDiagnosticWriteCount()).toBe(0)
  })

  it("does not add 0C to connect or sale auto-write paths", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
    setAutomaticCustomerDisplaySaleWritesEnabled(false)
    await writeCustomerDisplayAmount(12)
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
    expect(
      resolveCustomerDisplayIntent({
        status: "connected",
        cartCount: 1,
        runningTotal: 12,
        checkoutOpen: true,
        saleSuccess: null,
        autoUpdatesAllowed: false,
      })
    ).toEqual({ action: "none" })
  })

  it("suppresses automatic basket writes while diagnostic mode is on", async () => {
    expect(shouldSuppressAutoCustomerDisplayWrites(true)).toBe(true)
    expect(shouldSuppressAutoCustomerDisplayWrites(false)).toBe(false)
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

    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("9600"),
      diagnosticMode: true,
    })
    expect(isCustomerDisplayDiagnosticMode()).toBe(true)
    setAutomaticCustomerDisplaySaleWritesEnabled(true)
    await writeCustomerDisplayAmount(99.5)
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
    await setCustomerDisplayDiagnosticMode(false)
    await writeCustomerDisplayAmount(12)
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(1)
  })

  it("blocks sale amount writes on unverified tills even when connected", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setAutomaticCustomerDisplaySaleWritesEnabled(false)
    await writeCustomerDisplayAmount(12)
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
    setAutomaticCustomerDisplaySaleWritesEnabled(true)
    await writeCustomerDisplayAmount(12)
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(1)
    expect(Array.from(writeSerialBytesMock.mock.calls[0][1])).toEqual([0x31, 0x32, 0x2e, 0x30, 0x30])
  })

  it("never blocks sales when the display fails", async () => {
    await expect(writeCustomerDisplayAmount(12)).resolves.toBeUndefined()
    await expect(
      writeCustomerDisplayDiagnosticTest("ascii_0_00", { storage: memoryStorage() })
    ).resolves.toMatchObject({ ok: false })
  })

  it("records baud, test name, bytes, timestamp, and result locally", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: true,
    })
    const storage = memoryStorage()
    const result = await writeCustomerDisplayDiagnosticTest("ascii_0_00", { storage })
    expect(result.ok).toBe(true)
    expect(result.bytesHex).toBe("30 2E 30 30")
    const parsed = JSON.parse(storage.getItem("finza.retail.customerDisplay.diagnosticLog") || "[]")
    expect(parsed[0]).toMatchObject({
      baudRate: 2400,
      testName: "ASCII 0.00",
      testId: "ascii_0_00",
      bytesHex: "30 2E 30 30",
      ok: true,
      error: null,
    })
    expect(typeof parsed[0].timestamp).toBe("string")
    expect(
      appendCustomerDisplayDiagnosticLog([], {
        baudRate: 2400,
        testName: "ASCII 0.00",
        testId: "ascii_0_00",
        bytesHex: "30 2E 30 30",
        timestamp: "2026-09-15T00:00:00.000Z",
        ok: true,
        error: null,
      })
    ).toHaveLength(1)
  })
})

describe("customer display diagnostic does not touch cash drawer", () => {
  it("contains no cash-drawer commands in diagnostic modules", () => {
    const diagnostic = readRepo("lib/retail/hardware/customerDisplayDiagnostic.ts")
    const hardware = readRepo("lib/retail/hardware/retailPosHardware.ts")
    const bar = readRepo("components/retail/pos/RetailPosHardwareBar.tsx")
    const terminalConfig = readRepo("lib/retail/hardware/customerDisplayTerminalConfig.ts")
    for (const src of [diagnostic, hardware, bar, terminalConfig]) {
      expect(src).not.toMatch(/drawer_kick|openDrawer|pulseCashDrawer|buildCashDrawerKickBytes/i)
      expect(src).not.toMatch(/0x1b\s*,\s*0x70|\\x1b\\x70/)
    }
    expect(diagnostic).toMatch(/not a protocol fix/)
    expect(diagnostic).toMatch(/Unverified candidate for this till/)
    expect(bar).toMatch(/Test candidate clear \(0C\)/)
    expect(bar).toMatch(/Send clear then amount/)
    expect(bar).toMatch(/clearThenAmountWarning/)
    expect(bar).toMatch(/Unverified for this display/)
    expect(bar).toMatch(/Trial live totals on this till/)
    expect(bar).toMatch(/Start trial live totals/)
    expect(readRepo("app/retail/lib/printRetailSaleReceiptBrowser.ts")).toContain(
      "export const RETAIL_FINZA_DRAWER_KICK_ENABLED = false"
    )
  })
})

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
