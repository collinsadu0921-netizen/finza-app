import { createHash, randomBytes } from "node:crypto"

export const RETAIL_INVITE_EXPIRY_DAYS = 14

const RETAIL_INVITE_PATH = /^\/retail\/invite\/[A-Za-z0-9_-]{20,200}$/

export function normalizeRetailInviteEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isPlausibleRetailInviteEmail(email: string): boolean {
  const normalized = normalizeRetailInviteEmail(email)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 320
}

export function hashRetailInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

/** 32 bytes, base64url. Returned once to the operator. Only the hash is stored. */
export function generateRetailInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url")
  return { token, tokenHash: hashRetailInvitationToken(token) }
}

export function retailInvitationExpiresAt(from = new Date()): string {
  const d = new Date(from.getTime())
  d.setUTCDate(d.getUTCDate() + RETAIL_INVITE_EXPIRY_DAYS)
  return d.toISOString()
}

export function buildRetailInvitePath(token: string): string {
  return `/retail/invite/${encodeURIComponent(token)}`
}

/**
 * Accepts only a same-origin Retail invitation path.
 * Rejects protocol-relative and off-site values so login/signup `next` cannot be an open redirect.
 */
export function safeRetailInviteNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!RETAIL_INVITE_PATH.test(trimmed)) return null
  if (trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes("//")) return null
  return trimmed
}

export function retailInvitationTokenFromPath(path: string): string | null {
  const safe = safeRetailInviteNextPath(path)
  if (!safe) return null
  const token = safe.slice("/retail/invite/".length)
  try {
    return decodeURIComponent(token)
  } catch {
    return null
  }
}
