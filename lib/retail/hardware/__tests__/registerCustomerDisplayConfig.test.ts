import {
  assertNoComPortInConfigPayload,
  buildConfirmLocalImportPatch,
  buildRegisterCustomerDisplayWritePatch,
  cashierStatusLabelFromState,
  customerDisplayIdentityKey,
  formatCustomerDisplayOpenError,
  isRegisterCustomerDisplayConfigured,
  mapRegisterRowToCustomerDisplayConfig,
  nextCustomerDisplayLoadState,
  resolveCashierReadyLabel,
  resolveCustomerDisplayConnectAvailability,
  resolveOwnerTerminalDraft,
  shouldAllowAutomaticUpdatesFromRegisterConfig,
  shouldAllowAutomaticUpdatesFromServerSources,
  shouldCloseCustomerDisplayOnLifecycleChange,
  shouldFetchRegisterCustomerDisplayConfig,
  toCashierCustomerDisplayView,
  type RegisterCustomerDisplayConfig,
  type RegisterCustomerDisplayRow,
} from "@/lib/retail/hardware/registerCustomerDisplayConfig"
import { readFileSync } from "fs"
import { join } from "path"

const emptyRow = (over: Partial<RegisterCustomerDisplayRow> = {}): RegisterCustomerDisplayRow => ({
  id: "reg-1",
  business_id: "biz-1",
  store_id: "store-1",
  customer_display_enabled: false,
  customer_display_profile_id: null,
  customer_display_baud_rate: null,
  customer_display_data_bits: null,
  customer_display_stop_bits: null,
  customer_display_parity: null,
  customer_display_flow_control: null,
  customer_display_amount_write_mode: null,
  customer_display_physically_verified: false,
  customer_display_verified_at: null,
  customer_display_verified_by: null,
  customer_display_verified_note: null,
  customer_display_config_version: 0,
  customer_display_updated_at: null,
  ...over,
})

describe("register customer display server config", () => {
  it("treats unconfigured register as fail-closed (no universal 2400)", () => {
    const config = mapRegisterRowToCustomerDisplayConfig(emptyRow())
    expect(config.configured).toBe(false)
    expect(config.baudRate).toBeNull()
    expect(config.profileId).toBeNull()
    expect(shouldAllowAutomaticUpdatesFromRegisterConfig(config)).toBe(false)
    const view = toCashierCustomerDisplayView(config)
    expect(view.setupStatus).toBe("not_configured")
    expect(view.connectProfile).toBeNull()
    expect(view.message).toMatch(/owner\/admin setup/i)
  })

  it("does not allow cashier connect profile until physically verified", () => {
    const config = mapRegisterRowToCustomerDisplayConfig(
      emptyRow({
        customer_display_enabled: true,
        customer_display_profile_id: "2400",
        customer_display_baud_rate: 2400,
        customer_display_data_bits: 8,
        customer_display_stop_bits: 1,
        customer_display_parity: "none",
        customer_display_flow_control: "none",
        customer_display_amount_write_mode: "clear_then_amount",
        customer_display_physically_verified: false,
      })
    )
    expect(isRegisterCustomerDisplayConfigured(config)).toBe(true)
    expect(toCashierCustomerDisplayView(config).setupStatus).toBe("unverified")
    expect(shouldAllowAutomaticUpdatesFromRegisterConfig(config)).toBe(false)
  })

  it("exposes connect profile only for verified register", () => {
    const config = mapRegisterRowToCustomerDisplayConfig(
      emptyRow({
        customer_display_enabled: true,
        customer_display_profile_id: "2400",
        customer_display_baud_rate: 2400,
        customer_display_data_bits: 8,
        customer_display_stop_bits: 1,
        customer_display_parity: "none",
        customer_display_flow_control: "none",
        customer_display_amount_write_mode: "clear_then_amount",
        customer_display_physically_verified: true,
        customer_display_verified_at: "2026-09-15T12:00:00.000Z",
        customer_display_verified_by: "user-1",
      })
    )
    const view = toCashierCustomerDisplayView(config)
    expect(view.setupStatus).toBe("ready")
    expect(view.connectProfile?.baudRate).toBe(2400)
    expect(view.connectProfile?.amountWriteMode).toBe("clear_then_amount")
    expect(shouldAllowAutomaticUpdatesFromRegisterConfig(config)).toBe(true)
  })

  it("clears verification when baud/protocol changes", () => {
    const current: RegisterCustomerDisplayConfig = mapRegisterRowToCustomerDisplayConfig(
      emptyRow({
        customer_display_enabled: true,
        customer_display_profile_id: "2400",
        customer_display_baud_rate: 2400,
        customer_display_data_bits: 8,
        customer_display_stop_bits: 1,
        customer_display_parity: "none",
        customer_display_flow_control: "none",
        customer_display_amount_write_mode: "clear_then_amount",
        customer_display_physically_verified: true,
        customer_display_verified_at: "2026-09-15T12:00:00.000Z",
        customer_display_verified_by: "user-1",
        customer_display_config_version: 3,
      })
    )
    const result = buildRegisterCustomerDisplayWritePatch(
      current,
      { profileId: "9600", amountWriteMode: "ascii_only" },
      "admin-1",
      "2026-09-17T10:00:00.000Z"
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.clearsVerification).toBe(true)
    expect(result.patch.customer_display_physically_verified).toBe(false)
    expect(result.patch.customer_display_baud_rate).toBe(9600)
    expect(result.patch.customer_display_config_version).toBe(4)
  })

  it("rejects storing COM ports", () => {
    expect(assertNoComPortInConfigPayload({ comPort: "COM2" })).toMatch(/COM/i)
    expect(assertNoComPortInConfigPayload({ profileId: "2400" })).toBeNull()
  })

  it("requires explicit confirm for local import", () => {
    const current = mapRegisterRowToCustomerDisplayConfig(emptyRow())
    const denied = buildConfirmLocalImportPatch(
      current,
      { profileId: "2400", amountWriteMode: "clear_then_amount" },
      "admin-1",
      "2026-09-17T10:00:00.000Z",
      false
    )
    expect(denied.ok).toBe(false)

    const ok = buildConfirmLocalImportPatch(
      current,
      { profileId: "2400", amountWriteMode: "clear_then_amount" },
      "admin-1",
      "2026-09-17T10:00:00.000Z",
      true
    )
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.patch.customer_display_physically_verified).toBe(true)
    expect(ok.patch.customer_display_baud_rate).toBe(2400)
  })

  it("isolates store/register identity on mapped rows", () => {
    const a = mapRegisterRowToCustomerDisplayConfig(
      emptyRow({ id: "reg-a", store_id: "store-a", business_id: "biz-1" })
    )
    const b = mapRegisterRowToCustomerDisplayConfig(
      emptyRow({ id: "reg-b", store_id: "store-b", business_id: "biz-1" })
    )
    expect(a.registerId).not.toBe(b.registerId)
    expect(a.storeId).not.toBe(b.storeId)
  })

  it("labels cashier connection states without implying write success", () => {
    expect(
      resolveCashierReadyLabel({ setupStatus: "ready", connectionStatus: "disconnected" })
    ).toBe("Customer display: Ready to connect")
    expect(
      cashierStatusLabelFromState({ setupStatus: "not_configured", connectionStatus: "disconnected" })
    ).toBe("Customer display: Not configured")
    expect(
      cashierStatusLabelFromState({ setupStatus: "ready", connectionStatus: "connected" })
    ).toBe("Customer display: Connected")
  })

  it("does not refetch when terminalIdentity object is recreated with the same ids", () => {
    const keyA = customerDisplayIdentityKey({
      businessId: "biz-1",
      storeId: "store-1",
      registerId: "reg-1",
    })
    const keyB = customerDisplayIdentityKey({
      businessId: "biz-1",
      storeId: "store-1",
      registerId: "reg-1",
    })
    expect(keyA).toBe(keyB)
    expect(shouldFetchRegisterCustomerDisplayConfig(keyA, keyB)).toBe(false)
    expect(shouldFetchRegisterCustomerDisplayConfig(null, keyA)).toBe(true)
    expect(shouldFetchRegisterCustomerDisplayConfig(keyA, null)).toBe(false)
  })

  it("keeps load state stable during background revalidation", () => {
    expect(nextCustomerDisplayLoadState({ previous: "ready", phase: "start" })).toBe("ready")
    expect(nextCustomerDisplayLoadState({ previous: "idle", phase: "start" })).toBe("loading")
    expect(nextCustomerDisplayLoadState({ previous: "ready", phase: "success" })).toBe("ready")
  })

  it("does not alternate terminal draft between local and server once server is ready with a profile", () => {
    const server = mapRegisterRowToCustomerDisplayConfig(
      emptyRow({
        customer_display_enabled: true,
        customer_display_profile_id: "9600",
        customer_display_baud_rate: 9600,
        customer_display_data_bits: 8,
        customer_display_stop_bits: 1,
        customer_display_parity: "none",
        customer_display_flow_control: "none",
        customer_display_amount_write_mode: "ascii_only",
        customer_display_physically_verified: false,
      })
    )
    const local = {
      profileId: "2400" as const,
      physicallyVerified: true,
      verifiedAt: "2026-09-15T12:00:00.000Z",
      verifiedNote: "local",
      amountWriteMode: "clear_then_amount" as const,
      updatedAt: "2026-09-15T12:00:00.000Z",
    }
    const a = resolveOwnerTerminalDraft({
      serverConfig: server,
      local,
      serverLoadState: "ready",
    })
    const b = resolveOwnerTerminalDraft({
      serverConfig: server,
      local,
      serverLoadState: "ready",
    })
    expect(a.source).toBe("server")
    expect(a.terminalConfig.profileId).toBe("9600")
    expect(b.terminalConfig.profileId).toBe(a.terminalConfig.profileId)
    expect(a.terminalConfig.physicallyVerified).toBe(false)
  })

  it("enables Connect for owner after load without requiring verification; cashiers stay fail-closed", () => {
    const owner = resolveCustomerDisplayConnectAvailability({
      canUseDiagnostics: true,
      hasTerminalBinding: true,
      configLoadState: "ready",
      setupStatus: "unverified",
      webSerialSupported: true,
    })
    expect(owner.canConnect).toBe(true)
    expect(owner.reason).toBeNull()

    const cashier = resolveCustomerDisplayConnectAvailability({
      canUseDiagnostics: false,
      hasTerminalBinding: true,
      configLoadState: "ready",
      setupStatus: "unverified",
      webSerialSupported: true,
    })
    expect(cashier.canConnect).toBe(false)
    expect(cashier.reason).toMatch(/not been configured/i)

    const loading = resolveCustomerDisplayConnectAvailability({
      canUseDiagnostics: true,
      hasTerminalBinding: true,
      configLoadState: "loading",
      setupStatus: null,
      webSerialSupported: true,
    })
    expect(loading.canConnect).toBe(false)
    expect(loading.reason).toMatch(/still loading/i)

    const verifiedCashier = resolveCustomerDisplayConnectAvailability({
      canUseDiagnostics: false,
      hasTerminalBinding: true,
      configLoadState: "ready",
      setupStatus: "ready",
      webSerialSupported: true,
    })
    expect(verifiedCashier.canConnect).toBe(true)

    const backgroundReady = resolveCustomerDisplayConnectAvailability({
      canUseDiagnostics: false,
      hasTerminalBinding: true,
      configLoadState: "ready",
      setupStatus: "ready",
      webSerialSupported: true,
    })
    // Same resolved ready state must keep Connect enabled (no loading flicker).
    expect(backgroundReady.canConnect).toBe(true)
    expect(nextCustomerDisplayLoadState({ previous: "ready", phase: "start" })).toBe("ready")
  })

  it("does not close the shared serial session on role-only changes", () => {
    expect(
      shouldCloseCustomerDisplayOnLifecycleChange({
        previousIdentityKey: "biz:store:reg",
        nextIdentityKey: "biz:store:reg",
      })
    ).toBe("retain")
    expect(formatCustomerDisplayOpenError({ name: "NetworkError" })).toMatch(/already in use/i)
  })

  it("allows automatic updates from cashier-ready view without requiring full config", () => {
    const config = mapRegisterRowToCustomerDisplayConfig(
      emptyRow({
        customer_display_enabled: true,
        customer_display_profile_id: "2400",
        customer_display_baud_rate: 2400,
        customer_display_data_bits: 8,
        customer_display_stop_bits: 1,
        customer_display_parity: "none",
        customer_display_flow_control: "none",
        customer_display_amount_write_mode: "clear_then_amount",
        customer_display_physically_verified: true,
      })
    )
    const view = toCashierCustomerDisplayView(config)
    expect(
      shouldAllowAutomaticUpdatesFromServerSources({ serverConfig: null, serverView: view })
    ).toBe(true)
    expect(
      shouldAllowAutomaticUpdatesFromServerSources({ serverConfig: null, serverView: null })
    ).toBe(false)
  })

  it("does not hardcode COM2 in register display sources", () => {
    const root = join(__dirname, "../../../..")
    const sources = [
      "lib/retail/hardware/registerCustomerDisplayConfig.ts",
      "lib/retail/hardware/retailPosHardware.ts",
      "app/api/retail/registers/[registerId]/customer-display/route.ts",
      "components/retail/pos/useRetailPosHardware.ts",
    ]
    for (const rel of sources) {
      const text = readFileSync(join(root, rel), "utf8")
      expect(text).not.toMatch(/COM2/i)
      expect(text).not.toMatch(/\\\\\.\\COM/i)
    }
  })
})

describe("retail POS PWA assets", () => {
  const root = join(__dirname, "../../../..")

  it("has a valid installable manifest for Finza Retail", () => {
    const manifest = JSON.parse(
      readFileSync(join(root, "public/retail/pos/retail-pos-manifest.json"), "utf8")
    ) as Record<string, unknown>
    expect(manifest.name).toBe("Finza Retail")
    expect(manifest.short_name).toBe("Finza Retail")
    expect(manifest.display).toBe("standalone")
    expect(manifest.start_url).toBe("/retail/pos")
    expect(manifest.scope).toBe("/retail/pos")
    expect(Array.isArray(manifest.icons)).toBe(true)
    expect((manifest.icons as unknown[]).length).toBeGreaterThanOrEqual(2)
  })

  it("service worker skips API/auth/customer-display caching", () => {
    const sw = readFileSync(join(root, "public/retail/pos/retail-pos-sw.js"), "utf8")
    expect(sw).toMatch(/isSensitiveUrl/)
    expect(sw).toMatch(/\/api\//)
    expect(sw).toMatch(/customer-display/)
    expect(sw).toMatch(/skipWaiting/)
    expect(sw).not.toMatch(/cache\.put\(.*api/i)
  })

  it("API route sets no-store intent and HardwareBar separates owner vs cashier controls", () => {
    const api = readFileSync(
      join(root, "app/api/retail/registers/[registerId]/customer-display/route.ts"),
      "utf8"
    )
    expect(api).toMatch(/canEditBusinessWideSensitiveSettings/)
    expect(api).toMatch(/cashiers cannot change/i)

    const bar = readFileSync(join(root, "components/retail/pos/RetailPosHardwareBar.tsx"), "utf8")
    expect(bar).toMatch(/connectDisabledReason/)
    expect(bar).toMatch(/canUseDiagnostics/)
    expect(bar).toMatch(/Confirm and save to this register/)
    // Cashier path must not expose baud/protocol editors outside canUseDiagnostics block.
    const cashierOnlySection = bar.slice(0, bar.indexOf("{hardware.canUseDiagnostics ? ("))
    expect(cashierOnlySection).not.toMatch(/Serial profile/)
    expect(cashierOnlySection).not.toMatch(/markPhysicallyVerified/)
    expect(cashierOnlySection).not.toMatch(/Enter diagnostic/)
  })
})
