import { normalizeManualWalletPublicConfig } from "@/lib/settings/paymentProviders/service"
import { normalizeBusinessPaymentProviderRow } from "../providerConfig"
import { manualWalletInstructionsFromDefaultRow } from "../publicInvoiceManualWallet"
import { serializeManualWalletForCustomer } from "../serializeManualWalletForCustomer"
import type { BusinessPaymentProviderRow } from "../types"

const VALID_TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

describe("serializeManualWalletForCustomer", () => {
  it("returns full wallet_number for payers (not masked)", () => {
    const resolved = normalizeBusinessPaymentProviderRow({
      id: "p1",
      business_id: "b1",
      provider_type: "manual_wallet",
      environment: "live",
      is_enabled: true,
      is_default: true,
      validation_status: "unvalidated",
      validated_at: null,
      last_validation_message: null,
      public_config: {
        network: "mtn",
        account_name: "Acme Ltd",
        wallet_number: "0244999888",
        instructions: "Use inv # as reference",
        display_label: "Pay Acme",
      },
      secret_config_encrypted: null,
      created_at: "2020-01-01T00:00:00Z",
      updated_at: "2020-01-01T00:00:00Z",
    })
    if (resolved.kind !== "manual_wallet") throw new Error("expected manual_wallet")
    const out = serializeManualWalletForCustomer(resolved)
    expect(out.wallet_number).toBe("0244999888")
    expect(out.account_name).toBe("Acme Ltd")
    expect(out.provider_type).toBe("manual_wallet")
  })
})

describe("manualWalletInstructionsFromDefaultRow", () => {
  const base = (): BusinessPaymentProviderRow => ({
    id: "p1",
    business_id: "b1",
    provider_type: "manual_wallet",
    environment: "live",
    is_enabled: true,
    is_default: true,
    validation_status: "unvalidated",
    validated_at: null,
    last_validation_message: null,
    public_config: {
      wallet_number: "0244111222",
      display_label: "MoMo",
    },
    secret_config_encrypted: null,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
  })

  it("returns instructions when default manual_wallet row is enabled", () => {
    const out = manualWalletInstructionsFromDefaultRow(base())
    expect(out?.wallet_number).toBe("0244111222")
  })

  it("returns null when disabled (no customer exposure)", () => {
    const row = { ...base(), is_enabled: false }
    expect(manualWalletInstructionsFromDefaultRow(row)).toBeNull()
  })

  it("returns null for non-manual provider", () => {
    const row = { ...base(), provider_type: "mtn_momo_direct" }
    expect(manualWalletInstructionsFromDefaultRow(row)).toBeNull()
  })
})

describe("normalizeManualWalletPublicConfig", () => {
  it("requires wallet_number or display_label", () => {
    expect(() => normalizeManualWalletPublicConfig({ network: "x" })).toThrow(/wallet_number or display_label/)
  })

  it("accepts display_label only", () => {
    expect(normalizeManualWalletPublicConfig({ display_label: "Pay here" })).toEqual({
      network: "",
      account_name: "",
      wallet_number: "",
      instructions: "",
      display_label: "Pay here",
    })
  })
})

describe("admin mask vs customer serializer", () => {
  const prev = process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
  beforeAll(() => {
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
    else process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = prev
  })

  it("maskProviderConfigForUi masks wallet for settings list", async () => {
    const { maskProviderConfigForUi } = await import("../providerConfig")
    const row: BusinessPaymentProviderRow = {
      id: "p1",
      business_id: "b1",
      provider_type: "manual_wallet",
      environment: "live",
      is_enabled: true,
      is_default: false,
      validation_status: "unvalidated",
      validated_at: null,
      last_validation_message: null,
      public_config: { wallet_number: "0244999888" },
      secret_config_encrypted: null,
      created_at: "2020-01-01T00:00:00Z",
      updated_at: "2020-01-01T00:00:00Z",
    }
    const m = maskProviderConfigForUi(row)
    expect(String(m.public_config.wallet_number)).toContain("•")
    expect(String(m.public_config.wallet_number)).not.toContain("0244999888")
  })
})
