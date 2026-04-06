import {
  decryptProviderSecretConfig,
  encryptProviderSecretConfig,
  isEncryptedProviderSecretConfig,
} from "../encryptProviderSecrets"
import {
  TenantPaymentEncryptionKeyInvalidError,
  TenantPaymentEncryptionKeyMissingError,
  TenantPaymentMalformedSecretPayloadError,
} from "../errors"

/** 64 hex chars = 32-byte AES key (valid format for tests). */
const VALID_TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

describe("encryptProviderSecrets", () => {
  const prev = process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY

  beforeAll(() => {
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX
  })

  afterAll(() => {
    if (prev === undefined) delete process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
    else process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = prev
  })

  it("encrypt/decrypt roundtrip preserves object", () => {
    const plain = { api_key: "secret123", nested: { a: 1 } }
    const enc = encryptProviderSecretConfig(plain)
    expect(isEncryptedProviderSecretConfig(enc)).toBe(true)
    const dec = decryptProviderSecretConfig(enc)
    expect(dec).toEqual(plain)
  })

  it("decrypt fails on tampered ciphertext", () => {
    const enc = encryptProviderSecretConfig({ a: "b" })
    const tampered = enc.slice(0, -4) + "XXXX"
    expect(() => decryptProviderSecretConfig(tampered)).toThrow()
  })

  it("decrypt fails on garbage", () => {
    expect(() => decryptProviderSecretConfig("not-tpc")).toThrow(TenantPaymentMalformedSecretPayloadError)
  })

  it("encrypt fails when key missing", () => {
    delete process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
    expect(() => encryptProviderSecretConfig({})).toThrow(TenantPaymentEncryptionKeyMissingError)
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX
  })

  it("encrypt fails when key is not 32-byte material", () => {
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = "not-a-valid-key"
    expect(() => encryptProviderSecretConfig({})).toThrow(TenantPaymentEncryptionKeyInvalidError)
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX
  })

  it("encrypt fails for 63 hex chars", () => {
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX.slice(0, 63)
    expect(() => encryptProviderSecretConfig({})).toThrow(TenantPaymentEncryptionKeyInvalidError)
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX
  })
})
