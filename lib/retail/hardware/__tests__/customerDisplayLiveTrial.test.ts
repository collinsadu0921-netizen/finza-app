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

import { readFileSync } from "fs"
import { join } from "path"
import {
  LIVE_TRIAL_REQUIRED_PROFILE_ID,
  canStartCustomerDisplayLiveTrial,
  liveTrialIgnoresPhysicalVerification,
} from "@/lib/retail/hardware/customerDisplayLiveTrial"
import {
  __resetCustomerDisplaySessionForTests,
  connectCustomerDisplay,
  disconnectCustomerDisplay,
  isCustomerDisplayLiveTrialWritesEnabled,
  setAutomaticCustomerDisplaySaleWritesEnabled,
  setCustomerDisplayAmountWriteMode,
  setCustomerDisplayDiagnosticMode,
  setCustomerDisplayLiveTrialWritesEnabled,
  writeCustomerDisplayAmount,
  writeCustomerDisplayLiveTrialAmount,
} from "@/lib/retail/hardware/retailPosHardware"
import { getCustomerDisplaySerialProfile } from "@/lib/retail/hardware/customerDisplayDiagnostic"
import {
  closeSerialPort,
  listGrantedSerialPorts,
  openSerialPort,
  writeSerialBytes,
} from "@/lib/retail/hardware/webSerialPort"

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

describe("customer display live trial gate", () => {
  it("defaults off and ignores saved physical verification", () => {
    expect(isCustomerDisplayLiveTrialWritesEnabled()).toBe(false)
    expect(liveTrialIgnoresPhysicalVerification()).toBe(true)
    expect(LIVE_TRIAL_REQUIRED_PROFILE_ID).toBe("2400")
    const hook = readRepo("components/retail/pos/useRetailPosHardware.ts")
    expect(hook).toMatch(/useState\(false\)/)
    expect(hook).toMatch(/liveTrialActive/)
    expect(hook).not.toMatch(/physicallyVerified.*startLiveTrial|startLiveTrial.*physicallyVerified/)
  })

  it("requires owner/admin, bound till, connected 2400 profile, and diagnostic off", () => {
    const base = {
      canUseDiagnostics: true,
      hasTerminalBinding: true,
      status: "connected" as const,
      profileId: "2400" as const,
      connectedBaudRate: 2400,
      diagnosticMode: false,
    }
    expect(canStartCustomerDisplayLiveTrial(base)).toEqual({ ok: true, reason: null })
    expect(canStartCustomerDisplayLiveTrial({ ...base, canUseDiagnostics: false }).ok).toBe(false)
    expect(canStartCustomerDisplayLiveTrial({ ...base, hasTerminalBinding: false }).ok).toBe(false)
    expect(canStartCustomerDisplayLiveTrial({ ...base, status: "disconnected" }).ok).toBe(false)
    expect(canStartCustomerDisplayLiveTrial({ ...base, profileId: "9600" }).ok).toBe(false)
    expect(canStartCustomerDisplayLiveTrial({ ...base, connectedBaudRate: 9600 }).ok).toBe(false)
    expect(canStartCustomerDisplayLiveTrial({ ...base, diagnosticMode: true }).ok).toBe(false)
  })

  it("keeps the trial UI separate from Mark physically verified and does not hardcode COM2", () => {
    const bar = readRepo("components/retail/pos/RetailPosHardwareBar.tsx")
    expect(bar).toMatch(/Trial live totals on this till/)
    expect(bar).toMatch(/Start trial live totals/)
    expect(bar).toMatch(/Stop live trial/)
    expect(bar).toMatch(/separate from Mark physically verified/)
    expect(bar).not.toMatch(/COM2/i)
    expect(readRepo("lib/retail/hardware/customerDisplayLiveTrial.ts")).not.toMatch(/COM2/i)
    expect(readRepo("lib/retail/hardware/retailPosHardware.ts")).not.toMatch(/COM2/i)
  })
})

describe("customer display live trial writes", () => {
  beforeEach(() => {
    __resetCustomerDisplaySessionForTests()
    listGrantedSerialPortsMock.mockReset()
    openSerialPortMock.mockReset()
    writeSerialBytesMock.mockReset()
    closeSerialPortMock.mockReset()
    listGrantedSerialPortsMock.mockResolvedValue([fakePort() as never])
    openSerialPortMock.mockResolvedValue(undefined)
    writeSerialBytesMock.mockResolvedValue(undefined)
    closeSerialPortMock.mockResolvedValue(undefined)
  })

  it("sends exactly one 0C then one ASCII amount when the trial latch is on", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setAutomaticCustomerDisplaySaleWritesEnabled(false)
    setCustomerDisplayLiveTrialWritesEnabled(true)
    const result = await writeCustomerDisplayLiveTrialAmount(1234.56)
    expect(result).toEqual({ ok: true, error: null })
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(2)
    expect(Array.from(writeSerialBytesMock.mock.calls[0][1])).toEqual([0x0c])
    expect(Array.from(writeSerialBytesMock.mock.calls[1][1])).toEqual([
      0x31, 0x32, 0x33, 0x34, 0x2e, 0x35, 0x36,
    ])
  })

  it("stays off by default and does not write without the explicit trial latch", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    expect(isCustomerDisplayLiveTrialWritesEnabled()).toBe(false)
    const result = await writeCustomerDisplayLiveTrialAmount(12)
    expect(result.superseded).toBe(true)
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
  })

  it("does not enable verified auto-sale writes and leaves sales independent on write failure", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setAutomaticCustomerDisplaySaleWritesEnabled(false)
    setCustomerDisplayLiveTrialWritesEnabled(true)
    writeSerialBytesMock.mockRejectedValueOnce(new Error("port gone"))
    const trial = await writeCustomerDisplayLiveTrialAmount(12)
    expect(trial.ok).toBe(false)
    expect(trial.error).toMatch(/port gone|failed/i)
    await expect(writeCustomerDisplayAmount(99)).resolves.toMatchObject({ ok: true, skipped: true })
    // Verified latch still off — sale path must not auto-write.
    expect(writeSerialBytesMock.mock.calls.length).toBe(1)
  })

  it("suppresses live-trial writes while diagnostic mode is on", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: true,
    })
    setCustomerDisplayLiveTrialWritesEnabled(true)
    const result = await writeCustomerDisplayLiveTrialAmount(12)
    expect(result.superseded).toBe(true)
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
  })

  it("turns the latch off on disconnect helper path and stops further automatic writes", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setCustomerDisplayLiveTrialWritesEnabled(true)
    expect(isCustomerDisplayLiveTrialWritesEnabled()).toBe(true)
    setCustomerDisplayLiveTrialWritesEnabled(false)
    expect(isCustomerDisplayLiveTrialWritesEnabled()).toBe(false)
    const result = await writeCustomerDisplayLiveTrialAmount(12)
    expect(result.superseded).toBe(true)
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
    await disconnectCustomerDisplay()
    // Disconnect must not pretend to clear digits already on hardware.
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
  })

  it("serializes rapid changes so only the latest amount can land after older clears", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setCustomerDisplayLiveTrialWritesEnabled(true)

    let releaseFirstClear: (() => void) | undefined
    const firstClearGate = new Promise<void>((resolve) => {
      releaseFirstClear = resolve
    })
    let clearCount = 0
    writeSerialBytesMock.mockImplementation(async (_port, bytes) => {
      const list = Array.from(bytes)
      if (list.length === 1 && list[0] === 0x0c) {
        clearCount += 1
        if (clearCount === 1) await firstClearGate
      }
    })

    const first = writeCustomerDisplayLiveTrialAmount(1)
    const second = writeCustomerDisplayLiveTrialAmount(2.5)
    releaseFirstClear?.()
    const [a, b] = await Promise.all([first, second])
    expect(a.superseded || a.ok).toBe(true)
    expect(b.ok).toBe(true)

    const amountWrites = writeSerialBytesMock.mock.calls
      .map((call) => Array.from(call[1] as Uint8Array))
      .filter((bytes) => !(bytes.length === 1 && bytes[0] === 0x0c))
    expect(amountWrites.length).toBeGreaterThanOrEqual(1)
    expect(amountWrites[amountWrites.length - 1]).toEqual([0x32, 0x2e, 0x35, 0x30])
    // Never leave only the older 1.00 as the final amount write.
    if (amountWrites.length > 1) {
      expect(amountWrites.some((b) => b.join(",") === [0x31, 0x2e, 0x30, 0x30].join(","))).toBe(true)
    }
    expect(amountWrites[amountWrites.length - 1].join(",")).not.toBe([0x31, 0x2e, 0x30, 0x30].join(","))
  })

  it("does not treat diagnostic mode enable as a live-trial start", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    await setCustomerDisplayDiagnosticMode(true)
    expect(isCustomerDisplayLiveTrialWritesEnabled()).toBe(false)
    setCustomerDisplayLiveTrialWritesEnabled(true)
    const result = await writeCustomerDisplayLiveTrialAmount(12)
    expect(result.superseded).toBe(true)
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
  })
})

describe("candidate normal path clear-then-amount (verified latch)", () => {
  beforeEach(() => {
    __resetCustomerDisplaySessionForTests()
    listGrantedSerialPortsMock.mockReset()
    openSerialPortMock.mockReset()
    writeSerialBytesMock.mockReset()
    closeSerialPortMock.mockReset()
    listGrantedSerialPortsMock.mockResolvedValue([fakePort() as never])
    openSerialPortMock.mockResolvedValue(undefined)
    writeSerialBytesMock.mockResolvedValue(undefined)
    closeSerialPortMock.mockResolvedValue(undefined)
  })

  it("sends exact 0C then ASCII when sale latch is on and write mode is clear_then_amount", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setCustomerDisplayAmountWriteMode("clear_then_amount")
    setAutomaticCustomerDisplaySaleWritesEnabled(true)
    await writeCustomerDisplayAmount(8)
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(2)
    expect(Array.from(writeSerialBytesMock.mock.calls[0][1])).toEqual([0x0c])
    expect(Array.from(writeSerialBytesMock.mock.calls[1][1])).toEqual([0x38, 0x2e, 0x30, 0x30])
  })

  it("keeps unverified gate closed even when clear_then_amount mode is selected", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setCustomerDisplayAmountWriteMode("clear_then_amount")
    setAutomaticCustomerDisplaySaleWritesEnabled(false)
    await writeCustomerDisplayAmount(24)
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
  })

  it("uses plain ASCII only when write mode is ascii_only", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setCustomerDisplayAmountWriteMode("ascii_only")
    setAutomaticCustomerDisplaySaleWritesEnabled(true)
    await writeCustomerDisplayAmount(16)
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(1)
    expect(Array.from(writeSerialBytesMock.mock.calls[0][1])).toEqual([0x31, 0x36, 0x2e, 0x30, 0x30])
  })

  it("suppresses candidate sale writes in diagnostic mode", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: true,
    })
    setCustomerDisplayAmountWriteMode("clear_then_amount")
    setAutomaticCustomerDisplaySaleWritesEnabled(true)
    await writeCustomerDisplayAmount(8)
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
  })

  it("resets with 0C then 0.00 when writing amount 0 on the candidate path", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setCustomerDisplayAmountWriteMode("clear_then_amount")
    setAutomaticCustomerDisplaySaleWritesEnabled(true)
    await writeCustomerDisplayAmount(0)
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(2)
    expect(Array.from(writeSerialBytesMock.mock.calls[0][1])).toEqual([0x0c])
    expect(Array.from(writeSerialBytesMock.mock.calls[1][1])).toEqual([0x30, 0x2e, 0x30, 0x30])
  })

  it("never throws into the sale path on write failure or reconnect-needed error", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setCustomerDisplayAmountWriteMode("clear_then_amount")
    setAutomaticCustomerDisplaySaleWritesEnabled(true)
    writeSerialBytesMock.mockRejectedValueOnce(new Error("disconnect"))
    await expect(writeCustomerDisplayAmount(12)).resolves.toMatchObject({ ok: false })
    await disconnectCustomerDisplay()
    await expect(writeCustomerDisplayAmount(12)).resolves.toMatchObject({ ok: true, skipped: true })
  })

  it("orders rapid candidate sale writes so the latest amount lands last", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setCustomerDisplayAmountWriteMode("clear_then_amount")
    setAutomaticCustomerDisplaySaleWritesEnabled(true)

    let releaseFirstClear: (() => void) | undefined
    const firstClearGate = new Promise<void>((resolve) => {
      releaseFirstClear = resolve
    })
    let clearCount = 0
    writeSerialBytesMock.mockImplementation(async (_port, bytes) => {
      const list = Array.from(bytes)
      if (list.length === 1 && list[0] === 0x0c) {
        clearCount += 1
        if (clearCount === 1) await firstClearGate
      }
    })

    const first = writeCustomerDisplayAmount(8)
    const second = writeCustomerDisplayAmount(24)
    releaseFirstClear?.()
    await Promise.all([first, second])

    const amountWrites = writeSerialBytesMock.mock.calls
      .map((call) => Array.from(call[1] as Uint8Array))
      .filter((bytes) => !(bytes.length === 1 && bytes[0] === 0x0c))
    expect(amountWrites[amountWrites.length - 1]).toEqual([0x32, 0x34, 0x2e, 0x30, 0x30])
  })
})
