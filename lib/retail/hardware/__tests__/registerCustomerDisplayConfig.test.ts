import {
  assertNoComPortInConfigPayload,
  buildConfirmLocalImportPatch,
  buildRegisterCustomerDisplayWritePatch,
  cashierStatusLabelFromState,
  isRegisterCustomerDisplayConfigured,
  mapRegisterRowToCustomerDisplayConfig,
  resolveCashierReadyLabel,
  shouldAllowAutomaticUpdatesFromRegisterConfig,
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
})
