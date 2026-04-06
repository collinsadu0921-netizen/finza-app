import { encryptProviderSecretConfig } from "@/lib/tenantPayments/encryptProviderSecrets"
import {
  mergeHubtelMerchant,
  mergeHubtelSecrets,
  mergeMtnPublicFields,
  mergeMtnSecretPair,
  parseLegacyHubtel,
  parseLegacyMomo,
} from "../mergeIntegratedSecrets"

const VALID_TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

describe("parseLegacyMomo", () => {
  it("parses legacy primary_key field name", () => {
    const leg = parseLegacyMomo({ api_user: "u", api_key: "k", primary_key: "p", callback_url: "c" })
    expect(leg).toEqual({
      api_user: "u",
      api_key: "k",
      primary_key: "p",
      callback_url: "c",
    })
  })
})

describe("mergeMtnSecretPair", () => {
  const prev = process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
  beforeAll(() => {
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
    else process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = prev
  })

  it("prefers body values when present", () => {
    const enc = encryptProviderSecretConfig({ api_key: "old", primary_subscription_key: "oldp" })
    const r = mergeMtnSecretPair({
      bodyApiKey: "newk",
      bodyPrimaryKey: "newp",
      existingCiphertext: enc,
      legacy: { api_user: "u", api_key: "lk", primary_key: "lp", callback_url: "" },
    })
    expect(r).toEqual({ api_key: "newk", primary_subscription_key: "newp" })
  })

  it("falls back to legacy when body empty and no ciphertext", () => {
    const r = mergeMtnSecretPair({
      bodyApiKey: "",
      bodyPrimaryKey: "",
      existingCiphertext: null,
      legacy: { api_user: "u", api_key: "lk", primary_key: "lp", callback_url: "" },
    })
    expect(r).toEqual({ api_key: "lk", primary_subscription_key: "lp" })
  })

  it("returns null when nothing available", () => {
    expect(
      mergeMtnSecretPair({
        bodyApiKey: "",
        bodyPrimaryKey: "",
        existingCiphertext: null,
        legacy: null,
      })
    ).toBeNull()
  })
})

describe("mergeMtnPublicFields", () => {
  it("falls back to legacy for api_user and callback", () => {
    expect(
      mergeMtnPublicFields({
        bodyApiUser: "",
        bodyCallbackUrl: "",
        existingPublic: null,
        legacy: { api_user: "lu", api_key: "", primary_key: "", callback_url: "lc" },
      })
    ).toEqual({ api_user: "lu", callback_url: "lc" })
  })
})

describe("mergeHubtelSecrets", () => {
  const prev = process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
  beforeAll(() => {
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
    else process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = prev
  })

  it("reads legacy secret field name", () => {
    const r = mergeHubtelSecrets({
      bodyPosKey: "",
      bodyApiSecret: "",
      existingCiphertext: null,
      legacy: { pos_key: "p", secret: "s", merchant_account_number: "" },
    })
    expect(r).toEqual({ pos_key: "p", api_secret: "s" })
  })
})

describe("parseLegacyHubtel", () => {
  it("parses camelCase keys", () => {
    const leg = parseLegacyHubtel({ posKey: "a", secret: "b", merchantAccountNumber: "c" })
    expect(leg).toEqual({ pos_key: "a", secret: "b", merchant_account_number: "c" })
  })
})

describe("mergeHubtelMerchant", () => {
  it("uses legacy merchant when body empty", () => {
    expect(
      mergeHubtelMerchant({
        bodyMerchant: "",
        existingPublic: null,
        legacy: { pos_key: "", secret: "", merchant_account_number: "m1" },
      })
    ).toBe("m1")
  })
})
