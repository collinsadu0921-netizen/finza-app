import {
  formatCustomerDisplayOpenError,
  shouldCloseCustomerDisplayOnLifecycleChange,
  shouldAllowAutomaticUpdatesFromServerSources,
  toCashierCustomerDisplayView,
  mapRegisterRowToCustomerDisplayConfig,
  type RegisterCustomerDisplayRow,
} from "@/lib/retail/hardware/registerCustomerDisplayConfig"
import {
  __resetCustomerDisplaySessionForTests,
  connectCustomerDisplay,
  disconnectCustomerDisplay,
  getCustomerDisplayLastConnectOutcomeForTests,
  getCustomerDisplaySessionIdentityKey,
  getCustomerDisplayStatus,
  isCustomerDisplaySessionConnected,
  setAutomaticCustomerDisplaySaleWritesEnabled,
  setCustomerDisplayAmountWriteMode,
  writeCustomerDisplayAmount,
} from "@/lib/retail/hardware/retailPosHardware"
import { getCustomerDisplaySerialProfile } from "@/lib/retail/hardware/customerDisplayDiagnostic"

const listGrantedSerialPortsMock = jest.fn()
const openSerialPortMock = jest.fn()
const writeSerialBytesMock = jest.fn()
const closeSerialPortMock = jest.fn()
const requestSerialPortMock = jest.fn()

jest.mock("@/lib/retail/hardware/webSerialPort", () => ({
  listGrantedSerialPorts: (...args: unknown[]) => listGrantedSerialPortsMock(...args),
  openSerialPort: (...args: unknown[]) => openSerialPortMock(...args),
  writeSerialBytes: (...args: unknown[]) => writeSerialBytesMock(...args),
  closeSerialPort: (...args: unknown[]) => closeSerialPortMock(...args),
  requestSerialPort: (...args: unknown[]) => requestSerialPortMock(...args),
  getWebSerial: () => ({ requestPort: jest.fn(), getPorts: jest.fn() }),
}))

function fakePort() {
  return { open: jest.fn(), writable: {}, close: jest.fn() }
}

function verifiedRow(): RegisterCustomerDisplayRow {
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
  }
}

describe("customer display shared terminal session lifecycle", () => {
  const identityKey = "biz-1:store-1:reg-1"
  const otherKey = "biz-1:store-1:reg-2"

  beforeEach(() => {
    __resetCustomerDisplaySessionForTests()
    listGrantedSerialPortsMock.mockReset()
    openSerialPortMock.mockReset()
    writeSerialBytesMock.mockReset()
    closeSerialPortMock.mockReset()
    requestSerialPortMock.mockReset()
    const port = fakePort()
    listGrantedSerialPortsMock.mockResolvedValue([port as never])
    openSerialPortMock.mockResolvedValue(undefined)
    writeSerialBytesMock.mockResolvedValue(undefined)
    closeSerialPortMock.mockResolvedValue(undefined)
    requestSerialPortMock.mockResolvedValue(port as never)
  })

  it("retains the session across owner↔cashier role flips (identity unchanged)", () => {
    expect(
      shouldCloseCustomerDisplayOnLifecycleChange({
        previousIdentityKey: identityKey,
        nextIdentityKey: identityKey,
      })
    ).toBe("retain")
  })

  it("closes exactly when the bound register identity changes", () => {
    expect(
      shouldCloseCustomerDisplayOnLifecycleChange({
        previousIdentityKey: identityKey,
        nextIdentityKey: otherKey,
      })
    ).toBe("close_identity_changed")
    expect(
      shouldCloseCustomerDisplayOnLifecycleChange({
        previousIdentityKey: identityKey,
        nextIdentityKey: null,
      })
    ).toBe("clear_unbound")
  })

  it("owner connect once; second connect on same register reuses without close/open", async () => {
    const profile = getCustomerDisplaySerialProfile("2400")
    await connectCustomerDisplay({ profile, identityKey, diagnosticMode: false })
    expect(getCustomerDisplayLastConnectOutcomeForTests()).toBe("opened")
    expect(openSerialPortMock).toHaveBeenCalledTimes(1)
    expect(closeSerialPortMock).not.toHaveBeenCalled()

    // Simulate owner→cashier: same identity, connect again.
    await connectCustomerDisplay({ profile, identityKey, diagnosticMode: false })
    expect(getCustomerDisplayLastConnectOutcomeForTests()).toBe("reused")
    expect(openSerialPortMock).toHaveBeenCalledTimes(1)
    expect(closeSerialPortMock).not.toHaveBeenCalled()
    expect(isCustomerDisplaySessionConnected()).toBe(true)
    expect(getCustomerDisplaySessionIdentityKey()).toBe(identityKey)
  })

  it("cashier basket writes use the retained connection after role switch reuse", async () => {
    const view = toCashierCustomerDisplayView(mapRegisterRowToCustomerDisplayConfig(verifiedRow()))
    const profile = getCustomerDisplaySerialProfile("2400")
    await connectCustomerDisplay({ profile, identityKey, diagnosticMode: false })
    await connectCustomerDisplay({ profile, identityKey, diagnosticMode: false })
    expect(getCustomerDisplayLastConnectOutcomeForTests()).toBe("reused")

    setCustomerDisplayAmountWriteMode(view.connectProfile!.amountWriteMode)
    setAutomaticCustomerDisplaySaleWritesEnabled(
      shouldAllowAutomaticUpdatesFromServerSources({ serverConfig: null, serverView: view })
    )
    await writeCustomerDisplayAmount(12.5)
    expect(writeSerialBytesMock).toHaveBeenCalledTimes(2)
    expect(Array.from(writeSerialBytesMock.mock.calls[0][1])).toEqual([0x0c])
  })

  it("register identity change closes the old connection once", async () => {
    const profile = getCustomerDisplaySerialProfile("2400")
    await connectCustomerDisplay({ profile, identityKey, diagnosticMode: false })
    expect(getCustomerDisplayStatus()).toBe("connected")
    await disconnectCustomerDisplay()
    expect(closeSerialPortMock).toHaveBeenCalledTimes(1)
    expect(getCustomerDisplayStatus()).toBe("disconnected")
  })

  it("manual disconnect clears the shared session for both roles", async () => {
    const profile = getCustomerDisplaySerialProfile("2400")
    await connectCustomerDisplay({ profile, identityKey, diagnosticMode: false })
    await disconnectCustomerDisplay()
    expect(isCustomerDisplaySessionConnected()).toBe(false)
    await connectCustomerDisplay({ profile, identityKey, diagnosticMode: false })
    expect(getCustomerDisplayLastConnectOutcomeForTests()).toBe("opened")
  })

  it("reload-style reset starts disconnected without pretending the old port is open", () => {
    __resetCustomerDisplaySessionForTests()
    expect(getCustomerDisplayStatus()).toBe("disconnected")
    expect(isCustomerDisplaySessionConnected()).toBe(false)
    expect(getCustomerDisplayLastConnectOutcomeForTests()).toBe("none")
  })

  it("maps open failures to stable Error messages (no silent blink)", () => {
    expect(formatCustomerDisplayOpenError({ name: "NetworkError", message: "Failed to open" })).toBe(
      "This serial port is already in use."
    )
    expect(formatCustomerDisplayOpenError({ name: "SecurityError" })).toBe(
      "Serial permission was not granted."
    )
    expect(formatCustomerDisplayOpenError({ name: "NotFoundError" })).toBe("No serial device selected.")
    expect(formatCustomerDisplayOpenError(new Error("boom"))).toBe(
      "The selected port could not be opened."
    )
  })

  it("connection success alone is never treated as physical verification", () => {
    const unverified = toCashierCustomerDisplayView(
      mapRegisterRowToCustomerDisplayConfig({
        ...verifiedRow(),
        customer_display_physically_verified: false,
      })
    )
    expect(unverified.setupStatus).toBe("unverified")
    expect(
      shouldAllowAutomaticUpdatesFromServerSources({
        serverConfig: null,
        serverView: unverified,
      })
    ).toBe(false)
  })

  it("prevents a second open while connected unless force picker is requested", async () => {
    const profile = getCustomerDisplaySerialProfile("2400")
    await connectCustomerDisplay({ profile, identityKey })
    openSerialPortMock.mockClear()
    closeSerialPortMock.mockClear()
    await connectCustomerDisplay({ profile, identityKey })
    expect(openSerialPortMock).not.toHaveBeenCalled()
    expect(closeSerialPortMock).not.toHaveBeenCalled()

    // Force picker path may replace the port (Choose customer display).
    const other = fakePort()
    requestSerialPortMock.mockResolvedValueOnce(other as never)
    listGrantedSerialPortsMock.mockResolvedValueOnce([])
    await connectCustomerDisplay({ profile, identityKey, forcePortPicker: true })
    expect(getCustomerDisplayLastConnectOutcomeForTests()).toBe("opened")
  })
})
