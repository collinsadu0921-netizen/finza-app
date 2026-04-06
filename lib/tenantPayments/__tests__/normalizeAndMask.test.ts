import { encryptProviderSecretConfig } from "../encryptProviderSecrets"
import { TenantPaymentInvalidConfigError } from "../errors"
import {
  maskProviderConfigForUi,
  maskResolvedTenantProviderForUi,
  normalizeBusinessPaymentProviderRow,
} from "../providerConfig"
import type { BusinessPaymentProviderRow } from "../types"

const baseRow = (): Omit<BusinessPaymentProviderRow, "provider_type" | "public_config" | "secret_config_encrypted"> => ({
  id: "p1",
  business_id: "b1",
  environment: "live",
  is_enabled: true,
  is_default: true,
  validation_status: "unvalidated",
  validated_at: null,
  last_validation_message: null,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
})

const VALID_TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

describe("normalizeBusinessPaymentProviderRow", () => {
  const prev = process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
  beforeAll(() => {
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
    else process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = prev
  })

  it("manual wallet normalization works", () => {
    const row: BusinessPaymentProviderRow = {
      ...baseRow(),
      provider_type: "manual_wallet",
      public_config: {
        display_label: "MTN",
        wallet_number: "0244123456",
      },
      secret_config_encrypted: null,
    }
    const r = normalizeBusinessPaymentProviderRow(row)
    expect(r.kind).toBe("manual_wallet")
    expect(r.secrets).toBeNull()
    expect(r.public.wallet_number).toBe("0244123456")
  })

  it("manual wallet rejects secret blob", () => {
    const row: BusinessPaymentProviderRow = {
      ...baseRow(),
      provider_type: "manual_wallet",
      public_config: {},
      secret_config_encrypted: encryptProviderSecretConfig({ x: 1 }),
    }
    expect(() => normalizeBusinessPaymentProviderRow(row)).toThrow(TenantPaymentInvalidConfigError)
  })

  it("integrated mtn rejects incomplete decrypted secrets", () => {
    const row: BusinessPaymentProviderRow = {
      ...baseRow(),
      provider_type: "mtn_momo_direct",
      public_config: { api_user: "u1" },
      secret_config_encrypted: encryptProviderSecretConfig({ api_key: "k1" }),
    }
    expect(() => normalizeBusinessPaymentProviderRow(row)).toThrow(TenantPaymentInvalidConfigError)
  })

  it("integrated mtn normalizes when api_user is public and encrypted secrets omit api_user", () => {
    const row: BusinessPaymentProviderRow = {
      ...baseRow(),
      provider_type: "mtn_momo_direct",
      public_config: { api_user: "u1", target_environment: "mtnghana" },
      secret_config_encrypted: encryptProviderSecretConfig({
        api_key: "k1",
        primary_subscription_key: "pk1",
      }),
    }
    const r = normalizeBusinessPaymentProviderRow(row)
    expect(r.kind).toBe("mtn_momo_direct")
    if (r.kind === "mtn_momo_direct") {
      expect(r.secrets.api_user).toBe("u1")
      expect(r.secrets.api_key).toBe("k1")
    }
  })
})

describe("maskProviderConfigForUi", () => {
  it("never includes raw wallet_number in public_config", () => {
    const row: BusinessPaymentProviderRow = {
      ...baseRow(),
      provider_type: "manual_wallet",
      public_config: { wallet_number: "0244999888" },
      secret_config_encrypted: null,
    }
    const m = maskProviderConfigForUi(row)
    expect(m.public_config.wallet_number).toMatch(/••••/)
    expect(m.public_config.wallet_number).not.toContain("0244999888")
  })

  it("maskResolvedTenantProviderForUi matches row mask", () => {
    const prevKey = process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX
    const row: BusinessPaymentProviderRow = {
      ...baseRow(),
      provider_type: "mtn_momo_direct",
      public_config: { api_user: "u" },
      secret_config_encrypted: encryptProviderSecretConfig({
        api_key: "k",
        primary_subscription_key: "p",
      }),
    }
    const resolved = normalizeBusinessPaymentProviderRow(row)
    const m = maskResolvedTenantProviderForUi(resolved)
    expect(m.secret_present).toBe(true)
    expect(m.secret_summary).toContain("encrypted")
    expect(JSON.stringify(m)).not.toContain("primary_subscription_key")
    expect(JSON.stringify(m)).not.toContain("pk1")
    if (prevKey === undefined) delete process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
    else process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = prevKey
  })
})
