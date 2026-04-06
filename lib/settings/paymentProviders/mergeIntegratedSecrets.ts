import "server-only"

import { decryptProviderSecretConfig, isEncryptedProviderSecretConfig } from "@/lib/tenantPayments/encryptProviderSecrets"
import type { LegacyHubtelSettings, LegacyMomoSettings } from "./legacySync"

export function pickStr(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return ""
}

export function parseLegacyMomo(raw: unknown): LegacyMomoSettings | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const api_user = pickStr(o, "api_user", "apiUser")
  const api_key = pickStr(o, "api_key", "apiKey")
  const primary_key = pickStr(o, "primary_key", "primarySubscriptionKey", "primary_subscription_key")
  const callback_url = pickStr(o, "callback_url", "callbackUrl")
  if (!api_user && !api_key && !primary_key && !callback_url) return null
  return { api_user, api_key, primary_key, callback_url }
}

export function parseLegacyHubtel(raw: unknown): LegacyHubtelSettings | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const pos_key = pickStr(o, "pos_key", "posKey")
  const secret = pickStr(o, "secret", "api_secret")
  const merchant_account_number = pickStr(o, "merchant_account_number", "merchantAccountNumber")
  if (!pos_key && !secret && !merchant_account_number) return null
  return { pos_key, secret, merchant_account_number }
}

/** Merge MTN subscription keys from request body, encrypted row, and legacy JSON. Returns null if either key is still missing. */
export function mergeMtnSecretPair(input: {
  bodyApiKey?: string | undefined
  bodyPrimaryKey?: string | undefined
  existingCiphertext: string | null | undefined
  legacy: LegacyMomoSettings | null
}): { api_key: string; primary_subscription_key: string } | null {
  let api_key = (input.bodyApiKey ?? "").trim()
  let primary_subscription_key = (input.bodyPrimaryKey ?? "").trim()

  if (
    (!api_key || !primary_subscription_key) &&
    input.existingCiphertext &&
    isEncryptedProviderSecretConfig(input.existingCiphertext)
  ) {
    try {
      const dec = decryptProviderSecretConfig(input.existingCiphertext)
      if (!api_key) api_key = pickStr(dec, "api_key", "apiKey")
      if (!primary_subscription_key) {
        primary_subscription_key = pickStr(
          dec,
          "primary_subscription_key",
          "primarySubscriptionKey",
          "primary_key"
        )
      }
    } catch {
      /* treat as missing */
    }
  }

  if ((!api_key || !primary_subscription_key) && input.legacy) {
    if (!api_key) api_key = input.legacy.api_key
    if (!primary_subscription_key) primary_subscription_key = input.legacy.primary_key
  }

  if (!api_key || !primary_subscription_key) return null
  return { api_key, primary_subscription_key }
}

export function mergeMtnPublicFields(input: {
  bodyApiUser?: string | undefined
  bodyCallbackUrl?: string | undefined
  existingPublic: Record<string, unknown> | null | undefined
  legacy: LegacyMomoSettings | null
}): { api_user: string; callback_url: string } {
  let api_user = (input.bodyApiUser ?? "").trim()
  let callback_url = (input.bodyCallbackUrl ?? "").trim()

  if (!api_user && input.existingPublic) {
    api_user = pickStr(input.existingPublic, "api_user", "apiUser")
  }
  if (!callback_url && input.existingPublic) {
    callback_url = pickStr(input.existingPublic, "callback_url", "callbackUrl")
  }
  if (!api_user && input.legacy) api_user = input.legacy.api_user
  if (!callback_url && input.legacy) callback_url = input.legacy.callback_url

  return { api_user, callback_url }
}

export function mergeHubtelSecrets(input: {
  bodyPosKey?: string | undefined
  bodyApiSecret?: string | undefined
  existingCiphertext: string | null | undefined
  legacy: LegacyHubtelSettings | null
}): { pos_key: string; api_secret: string } | null {
  let pos_key = (input.bodyPosKey ?? "").trim()
  let api_secret = (input.bodyApiSecret ?? "").trim()

  if (
    (!pos_key || !api_secret) &&
    input.existingCiphertext &&
    isEncryptedProviderSecretConfig(input.existingCiphertext)
  ) {
    try {
      const dec = decryptProviderSecretConfig(input.existingCiphertext)
      if (!pos_key) pos_key = pickStr(dec, "pos_key", "posKey")
      if (!api_secret) api_secret = pickStr(dec, "api_secret", "secret")
    } catch {
      /* missing */
    }
  }

  if ((!pos_key || !api_secret) && input.legacy) {
    if (!pos_key) pos_key = input.legacy.pos_key
    if (!api_secret) api_secret = input.legacy.secret
  }

  if (!pos_key || !api_secret) return null
  return { pos_key, api_secret }
}

export function mergeHubtelMerchant(input: {
  bodyMerchant?: string | undefined
  existingPublic: Record<string, unknown> | null | undefined
  legacy: LegacyHubtelSettings | null
}): string {
  let merchant = (input.bodyMerchant ?? "").trim()
  if (!merchant && input.existingPublic) {
    merchant = pickStr(input.existingPublic, "merchant_account_number", "merchantAccountNumber")
  }
  if (!merchant && input.legacy) merchant = input.legacy.merchant_account_number
  return merchant
}
