import "server-only"

import { randomBytes } from "crypto"

/** Hubtel REST clientReference prefix — total length must be ≤ 32. */
export const HUBTEL_CLIENT_REFERENCE_PREFIX = "FZHB"

const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

/** Hubtel REST docs: clientReference max 32 characters. */
export const HUBTEL_CLIENT_REFERENCE_MAX_LEN = 32

/**
 * Generate a unique Hubtel clientReference (max 32 chars).
 * Format: FZHB + 28 uppercase alphanumeric characters.
 */
export function generateHubtelClientReference(): string {
  const suffixLen = HUBTEL_CLIENT_REFERENCE_MAX_LEN - HUBTEL_CLIENT_REFERENCE_PREFIX.length
  const bytes = randomBytes(suffixLen)
  let suffix = ""
  for (let i = 0; i < suffixLen; i++) {
    suffix += ALPHANUM[bytes[i]! % ALPHANUM.length]
  }
  const ref = `${HUBTEL_CLIENT_REFERENCE_PREFIX}${suffix}`
  if (ref.length > HUBTEL_CLIENT_REFERENCE_MAX_LEN) {
    throw new Error("Generated Hubtel clientReference exceeds max length")
  }
  return ref
}

export function isHubtelInvoiceClientReference(reference: string): boolean {
  return reference.trim().startsWith(HUBTEL_CLIENT_REFERENCE_PREFIX)
}
