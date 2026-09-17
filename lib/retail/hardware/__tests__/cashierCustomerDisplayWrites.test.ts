import {
  resolveAmountWriteModeFromServerSources,
  shouldAllowAutomaticUpdatesFromServerSources,
  toCashierCustomerDisplayView,
  mapRegisterRowToCustomerDisplayConfig,
  type RegisterCustomerDisplayRow,
  type CashierRegisterCustomerDisplayView,
} from "@/lib/retail/hardware/registerCustomerDisplayConfig"
import {
  __resetCustomerDisplaySessionForTests,
  areAutomaticCustomerDisplaySaleWritesEnabled,
  connectCustomerDisplay,
  getCustomerDisplayStatus,
  setAutomaticCustomerDisplaySaleWritesEnabled,
  setCustomerDisplayAmountWriteMode,
  writeCustomerDisplayAmount,
} from "@/lib/retail/hardware/retailPosHardware"
import { getCustomerDisplaySerialProfile } from "@/lib/retail/hardware/customerDisplayDiagnostic"
import { resolveCustomerDisplayIntent } from "@/lib/retail/hardware/customerDisplayProtocol"

const listGrantedSerialPortsMock = jest.fn()
const openSerialPortMock = jest.fn()
const writeSerialBytesMock = jest.fn()
const closeSerialPortMock = jest.fn()

jest.mock("@/lib/retail/hardware/webSerialPort", () => ({
  listGrantedSerialPorts: (...args: unknown[]) => listGrantedSerialPortsMock(...args),
  openSerialPort: (...args: unknown[]) => openSerialPortMock(...args),
  writeSerialBytes: (...args: unknown[]) => writeSerialBytesMock(...args),
  closeSerialPort: (...args: unknown[]) => closeSerialPortMock(...args),
  requestSerialPort: jest.fn(),
  getWebSerial: () => ({ requestPort: jest.fn(), getPorts: jest.fn() }),
}))

function fakePort() {
  return { open: jest.fn(), writable: {}, close: jest.fn() }
}

function verifiedRow(over: Partial<RegisterCustomerDisplayRow> = {}): RegisterCustomerDisplayRow {
  return {
    id: "reg-1",
    business_id: "biz-1",
    store_id: "store-1",
    customer_display_enabled: true,
    customer_display_profile_id: "2400",
    customer_display_baud_rate: 2400,
    customer_display_data_bits: 8,
    customer_display_stop_bits: 1,
    customer_display_parity: "none",
    customer_display_flow_control: "none",
    customer_display_amount_write_mode: "clear_then_amount",
    customer_display_physically_verified: true,
    customer_display_verified_at: "2026-09-17T00:00:00.000Z",
    customer_display_verified_by: "owner-1",
    customer_display_verified_note: "verified",
    customer_display_config_version: 2,
    customer_display_updated_at: "2026-09-17T00:00:00.000Z",
    ...over,
  }
}

describe("cashier automatic writes from server view (no full config)", () => {
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

  it("allows automatic updates from cashier-ready view without serverConfig", () => {
    const config = mapRegisterRowToCustomerDisplayConfig(verifiedRow())
    const view = toCashierCustomerDisplayView(config)
    expect(view.setupStatus).toBe("ready")
    expect(
      shouldAllowAutomaticUpdatesFromServerSources({ serverConfig: null, serverView: view })
    ).toBe(true)
    expect(
      resolveAmountWriteModeFromServerSources({
        serverConfig: null,
        serverView: view,
        fallbackProfileId: "9600",
        fallbackMode: "ascii_only",
      })
    ).toBe("clear_then_amount")
  })

  it("fails closed for unverified/disabled/missing views", () => {
    const unverified = toCashierCustomerDisplayView(
      mapRegisterRowToCustomerDisplayConfig(
        verifiedRow({ customer_display_physically_verified: false })
      )
    )
    expect(
      shouldAllowAutomaticUpdatesFromServerSources({
        serverConfig: null,
        serverView: unverified,
      })
    ).toBe(false)

    const disabled = toCashierCustomerDisplayView(
      mapRegisterRowToCustomerDisplayConfig(verifiedRow({ customer_display_enabled: false }))
    )
    expect(
      shouldAllowAutomaticUpdatesFromServerSources({ serverConfig: null, serverView: disabled })
    ).toBe(false)

    expect(
      shouldAllowAutomaticUpdatesFromServerSources({ serverConfig: null, serverView: null })
    ).toBe(false)
  })

  it("connect alone sends no bytes; basket total change sends 0C then ASCII", async () => {
    const view = toCashierCustomerDisplayView(mapRegisterRowToCustomerDisplayConfig(verifiedRow()))
    expect(view.connectProfile?.amountWriteMode).toBe("clear_then_amount")

    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    expect(writeSerialBytesMock).not.toHaveBeenCalled()

    setCustomerDisplayAmountWriteMode(view.connectProfile!.amountWriteMode)
    setAutomaticCustomerDisplaySaleWritesEnabled(
      shouldAllowAutomaticUpdatesFromServerSources({ serverConfig: null, serverView: view })
    )

    // Simulate connect baseline: intent would write, but Connect itself must stay quiet.
    const atConnect = resolveCustomerDisplayIntent({
      status: "connected",
      cartCount: 1,
      runningTotal: 12.5,
      checkoutOpen: false,
      saleSuccess: null,
      autoUpdatesAllowed: true,
    })
    expect(atConnect.action).toBe("write")
    // After a genuine change:
    const afterChange = resolveCustomerDisplayIntent({
      status: "connected",
      cartCount: 2,
      runningTotal: 25,
      checkoutOpen: false,
      saleSuccess: null,
      autoUpdatesAllowed: true,
    })
    expect(afterChange).toEqual({ action: "write", amount: 25 })
    await writeCustomerDisplayAmount(25)
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(2)
    expect(Array.from(writeSerialBytesMock.mock.calls[0][1])).toEqual([0x0c])
    expect(Array.from(writeSerialBytesMock.mock.calls[1][1])).toEqual([
      0x32, 0x35, 0x2e, 0x30, 0x30,
    ])
  })

  it("second total change sends a new clear-then-amount sequence", async () => {
    const view = toCashierCustomerDisplayView(mapRegisterRowToCustomerDisplayConfig(verifiedRow()))
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setCustomerDisplayAmountWriteMode("clear_then_amount")
    setAutomaticCustomerDisplaySaleWritesEnabled(true)
    await writeCustomerDisplayAmount(8)
    await writeCustomerDisplayAmount(16)
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(4)
    expect(Array.from(writeSerialBytesMock.mock.calls[2][1])).toEqual([0x0c])
    expect(Array.from(writeSerialBytesMock.mock.calls[3][1])).toEqual([
      0x31, 0x36, 0x2e, 0x30, 0x30,
    ])
    expect(view.setupStatus).toBe("ready")
  })

  it("completed sale resets with 0C then 0.00", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setCustomerDisplayAmountWriteMode("clear_then_amount")
    setAutomaticCustomerDisplaySaleWritesEnabled(true)
    const intent = resolveCustomerDisplayIntent({
      status: "connected",
      cartCount: 0,
      runningTotal: 0,
      checkoutOpen: false,
      saleSuccess: { cashReceived: 20, changeGiven: 5 },
      autoUpdatesAllowed: true,
    })
    expect(intent.action).toBe("writeThenIdle")
    if (intent.action !== "writeThenIdle") return
    await writeCustomerDisplayAmount(intent.amount)
    await writeCustomerDisplayAmount(0)
    const lastClear = writeSerialBytesMock.mock.calls[writeSerialBytesMock.mock.calls.length - 2][1]
    const lastAmount = writeSerialBytesMock.mock.calls[writeSerialBytesMock.mock.calls.length - 1][1]
    expect(Array.from(lastClear)).toEqual([0x0c])
    expect(Array.from(lastAmount)).toEqual([0x30, 0x2e, 0x30, 0x30])
  })

  it("cancelled/empty cart resets with 0C then 0.00", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setCustomerDisplayAmountWriteMode("clear_then_amount")
    setAutomaticCustomerDisplaySaleWritesEnabled(true)
    const intent = resolveCustomerDisplayIntent({
      status: "connected",
      cartCount: 0,
      runningTotal: 0,
      checkoutOpen: false,
      saleSuccess: null,
      autoUpdatesAllowed: true,
    })
    expect(intent).toEqual({ action: "write", amount: 0 })
    await writeCustomerDisplayAmount(0)
    expect(Array.from(writeSerialBytesMock.mock.calls[0][1])).toEqual([0x0c])
    expect(Array.from(writeSerialBytesMock.mock.calls[1][1])).toEqual([0x30, 0x2e, 0x30, 0x30])
  })

  it("write failure sets Error and disables further automatic writes without throwing", async () => {
    await connectCustomerDisplay({
      profile: getCustomerDisplaySerialProfile("2400"),
      diagnosticMode: false,
    })
    setCustomerDisplayAmountWriteMode("clear_then_amount")
    setAutomaticCustomerDisplaySaleWritesEnabled(true)
    writeSerialBytesMock.mockRejectedValueOnce(new Error("port gone"))
    const result = await writeCustomerDisplayAmount(12)
    expect(result.ok).toBe(false)
    expect(getCustomerDisplayStatus()).toBe("error")
    expect(areAutomaticCustomerDisplaySaleWritesEnabled()).toBe(false)
    writeSerialBytesMock.mockClear()
    await writeCustomerDisplayAmount(99)
    expect(writeSerialBytesMock).not.toHaveBeenCalled()
  })

  it("wrong-register style null view never enables the sale latch", () => {
    const view: CashierRegisterCustomerDisplayView = {
      registerId: "other-reg",
      setupStatus: "not_configured",
      message: "setup",
      connectProfile: null,
    }
    expect(
      shouldAllowAutomaticUpdatesFromServerSources({ serverConfig: null, serverView: view })
    ).toBe(false)
    setAutomaticCustomerDisplaySaleWritesEnabled(
      shouldAllowAutomaticUpdatesFromServerSources({ serverConfig: null, serverView: view })
    )
    expect(areAutomaticCustomerDisplaySaleWritesEnabled()).toBe(false)
  })
})
