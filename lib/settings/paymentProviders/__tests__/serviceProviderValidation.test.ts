import { encryptProviderSecretConfig } from "@/lib/tenantPayments/encryptProviderSecrets"
import { maskProviderConfigForUi } from "@/lib/tenantPayments/providerConfig"
import type { BusinessPaymentProviderRow } from "@/lib/tenantPayments/types"
import {
  mergeHubtelMerchant,
  mergeHubtelSecrets,
  mergeMtnSecretPair,
} from "../mergeIntegratedSecrets"
import {
  mergeManualWalletPublicConfig,
  normalizeManualWalletPublicConfig,
} from "../service"

const VALID_TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

describe("provider-specific validation isolation", () => {
  const prev = process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
  beforeAll(() => {
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
    else process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = prev
  })

  describe("Hubtel credentials (merge only — no manual_wallet / MTN)", () => {
    it("fails when API ID and API Key are missing on create", () => {
      const hubSecrets = mergeHubtelSecrets({
        bodyApiId: "",
        bodyApiKey: "",
        existingCiphertext: null,
        legacy: null,
      })
      expect(hubSecrets).toBeNull()
    })

    it("fails when Collection Account Number is missing on create", () => {
      const merchant = mergeHubtelMerchant({
        bodyMerchant: "",
        existingPublic: null,
        legacy: null,
      })
      expect(merchant.trim()).toBe("")
    })

    it("accepts Hubtel fields without touching manual_wallet or MTN", () => {
      const hubSecrets = mergeHubtelSecrets({
        bodyApiId: "hub-id",
        bodyApiKey: "hub-key",
        existingCiphertext: null,
        legacy: null,
      })
      const merchant = mergeHubtelMerchant({
        bodyMerchant: "123456",
        existingPublic: null,
        legacy: null,
      })
      expect(hubSecrets).toEqual({ api_id: "hub-id", api_key: "hub-key" })
      expect(merchant).toBe("123456")

      const mtn = mergeMtnSecretPair({
        bodyApiKey: "",
        bodyPrimaryKey: "",
        existingCiphertext: null,
        legacy: null,
      })
      expect(mtn).toBeNull()
      expect(() => normalizeManualWalletPublicConfig({ network: "only" })).toThrow(
        /wallet_number or display_label/
      )
    })

    it("does not return API Key in masked Hubtel UI response", () => {
      const row: BusinessPaymentProviderRow = {
        id: "p-hub",
        business_id: "b1",
        provider_type: "hubtel",
        environment: "live",
        is_enabled: true,
        is_default: false,
        validation_status: "unvalidated",
        validated_at: null,
        last_validation_message: null,
        created_at: "2020-01-01T00:00:00Z",
        updated_at: "2020-01-01T00:00:00Z",
        public_config: { merchant_account_number: "999", collection_account_number: "999" },
        secret_config_encrypted: encryptProviderSecretConfig({
          api_id: "id-secret",
          api_key: "key-secret",
        }),
      }
      const json = JSON.stringify(maskProviderConfigForUi(row))
      expect(json).not.toContain("key-secret")
      expect(json).not.toContain("id-secret")
    })
  })

  describe("manual_wallet validation", () => {
    it("requires wallet_number or display_label when enabled (default)", () => {
      expect(() => normalizeManualWalletPublicConfig({ network: "mtn" })).toThrow(
        /wallet_number or display_label/
      )
    })

    it("allows incomplete config when disabled", () => {
      expect(
        normalizeManualWalletPublicConfig({ network: "mtn" }, { requireWalletOrLabel: false })
      ).toEqual({
        network: "mtn",
        account_name: "",
        wallet_number: "",
        instructions: "",
        display_label: "",
      })
    })

    it("merge preserves wallet_number when PATCH sends empty string (Hubtel save must not poison manual)", () => {
      const merged = mergeManualWalletPublicConfig(
        { wallet_number: "0244123456", display_label: "Pay here" },
        { network: "mtn", wallet_number: "", display_label: "" }
      )
      expect(merged.wallet_number).toBe("0244123456")
      expect(merged.display_label).toBe("Pay here")
      expect(() =>
        normalizeManualWalletPublicConfig(merged, { requireWalletOrLabel: true })
      ).not.toThrow()
    })

    it("disabled incomplete manual_wallet does not block Hubtel-style partial merge", () => {
      const merged = mergeManualWalletPublicConfig({ network: "vodafone" }, { network: "mtn" })
      expect(
        normalizeManualWalletPublicConfig(merged, { requireWalletOrLabel: false })
      ).toMatchObject({ network: "mtn" })
    })
  })
})
