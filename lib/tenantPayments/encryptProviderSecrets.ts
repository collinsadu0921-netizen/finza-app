import "server-only"

/**
 * Application-layer encryption for business_payment_providers.secret_config_encrypted.
 * Import only from server contexts (API routes, Server Actions, server lib).
 *
 * Payload format (versioned):
 *   TPC1:<base64url(JSON.stringify({ v: 1, iv, tag, data }))>
 * where iv, tag, data are base64url-encoded strings for AES-256-GCM.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto"
import {
  TenantPaymentDecryptError,
  TenantPaymentEncryptError,
  TenantPaymentEncryptionKeyInvalidError,
  TenantPaymentEncryptionKeyMissingError,
  TenantPaymentMalformedSecretPayloadError,
} from "./errors"

const PAYLOAD_VERSION = 1 as const
const PREFIX = "TPC1:"
const ALGO = "aes-256-gcm"
const IV_LEN = 12
const KEY_BYTE_LEN = 32

/** 64 hex characters = 32 bytes (case-insensitive). */
const HEX64 = /^[0-9a-fA-F]{64}$/

type EncodedPayloadV1 = {
  v: typeof PAYLOAD_VERSION
  iv: string
  tag: string
  data: string
}

/**
 * Parse TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY into a 32-byte AES key.
 * Accepted formats (trimmed):
 * - 64 hexadecimal characters
 * - Standard Base64 or Base64url encoding of exactly 32 raw bytes (decoded length 32)
 */
export function parseTenantPaymentEncryptionKeyFromEnv(): Buffer {
  const raw = process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY?.trim()
  if (!raw) {
    throw new TenantPaymentEncryptionKeyMissingError()
  }

  if (HEX64.test(raw)) {
    const buf = Buffer.from(raw, "hex")
    if (buf.length !== KEY_BYTE_LEN) {
      throw new TenantPaymentEncryptionKeyInvalidError("Hex key decoded to wrong length (expected 32 bytes).")
    }
    return buf
  }

  let decoded: Buffer
  try {
    decoded = Buffer.from(raw, "base64")
  } catch {
    decoded = Buffer.alloc(0)
  }
  if (decoded.length === KEY_BYTE_LEN) {
    return decoded
  }

  try {
    decoded = Buffer.from(raw, "base64url")
  } catch {
    throw new TenantPaymentEncryptionKeyInvalidError()
  }
  if (decoded.length === KEY_BYTE_LEN) {
    return decoded
  }

  throw new TenantPaymentEncryptionKeyInvalidError()
}

function getEncryptionKey(): Buffer {
  return parseTenantPaymentEncryptionKeyFromEnv()
}

function toB64Url(buf: Buffer): string {
  return buf.toString("base64url")
}

function fromB64Url(s: string): Buffer {
  return Buffer.from(s, "base64url")
}

/**
 * Returns true if the string looks like ciphertext produced by this module.
 */
export function isEncryptedProviderSecretConfig(value: string | null | undefined): boolean {
  if (value == null || typeof value !== "string") return false
  return value.startsWith(PREFIX)
}

/**
 * Encrypt a plain object of secret fields to a single stored string.
 */
export function encryptProviderSecretConfig(input: object): string {
  let key: Buffer
  try {
    key = getEncryptionKey()
  } catch (e) {
    if (e instanceof TenantPaymentEncryptionKeyMissingError) throw e
    if (e instanceof TenantPaymentEncryptionKeyInvalidError) throw e
    throw new TenantPaymentEncryptError("Failed to read encryption key", { cause: e })
  }

  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: 16 })
  const plaintext = Buffer.from(JSON.stringify(input), "utf8")
  let enc = cipher.update(plaintext)
  enc = Buffer.concat([enc, cipher.final()])
  const tag = cipher.getAuthTag()

  const body: EncodedPayloadV1 = {
    v: PAYLOAD_VERSION,
    iv: toB64Url(iv),
    tag: toB64Url(tag),
    data: toB64Url(enc),
  }

  try {
    return PREFIX + toB64Url(Buffer.from(JSON.stringify(body), "utf8"))
  } catch (e) {
    throw new TenantPaymentEncryptError("Failed to encode ciphertext", { cause: e })
  }
}

/**
 * Decrypt stored ciphertext back to a plain object (secrets).
 */
export function decryptProviderSecretConfig(ciphertext: string): Record<string, unknown> {
  let key: Buffer
  try {
    key = getEncryptionKey()
  } catch (e) {
    if (e instanceof TenantPaymentEncryptionKeyMissingError) throw e
    if (e instanceof TenantPaymentEncryptionKeyInvalidError) throw e
    throw new TenantPaymentDecryptError("Failed to read encryption key", { cause: e })
  }

  if (!isEncryptedProviderSecretConfig(ciphertext)) {
    throw new TenantPaymentMalformedSecretPayloadError(
      "Secret payload is not a valid TPC1 envelope"
    )
  }

  const b64 = ciphertext.slice(PREFIX.length)
  let outer: EncodedPayloadV1
  try {
    const raw = fromB64Url(b64).toString("utf8")
    outer = JSON.parse(raw) as EncodedPayloadV1
  } catch (e) {
    throw new TenantPaymentMalformedSecretPayloadError("Could not parse TPC1 outer JSON", {
      cause: e,
    })
  }

  if (outer.v !== PAYLOAD_VERSION || !outer.iv || !outer.tag || !outer.data) {
    throw new TenantPaymentMalformedSecretPayloadError("TPC1 payload missing fields or wrong version")
  }

  let iv: Buffer
  let tag: Buffer
  let data: Buffer
  try {
    iv = fromB64Url(outer.iv)
    tag = fromB64Url(outer.tag)
    data = fromB64Url(outer.data)
  } catch (e) {
    throw new TenantPaymentMalformedSecretPayloadError("Invalid base64url in TPC1 payload", {
      cause: e,
    })
  }

  try {
    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: 16 })
    decipher.setAuthTag(tag)
    let dec = decipher.update(data)
    dec = Buffer.concat([dec, decipher.final()])
    const parsed = JSON.parse(dec.toString("utf8")) as unknown
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TenantPaymentMalformedSecretPayloadError("Decrypted JSON must be an object")
    }
    return parsed as Record<string, unknown>
  } catch (e) {
    if (e instanceof TenantPaymentMalformedSecretPayloadError) throw e
    if (e instanceof TenantPaymentDecryptError) throw e
    throw new TenantPaymentDecryptError("Decryption or JSON parse failed (wrong key or corrupt data)", {
      cause: e,
    })
  }
}
