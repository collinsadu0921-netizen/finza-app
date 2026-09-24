import { createHash, randomBytes } from "node:crypto"

export const RETAIL_INVITE_EXPIRY_DAYS = 14

const RETAIL_INVITE_PATH = /^\/retail\/invite\/[A-Za-z0-9_-]{20,200}$/
export const RETAIL_INVITE_RESUME_PATH = "/retail/invite/resume"
export const RETAIL_INVITE_RESUME_SEGMENT = "resume"

/** Raw invitation tokens are base64url and at least 20 chars. Reserved path segments are never tokens. */
export function isPlausibleRetailInviteToken(token: string | null | undefined): boolean {
  if (!token) return false
  const trimmed = token.trim()
  if (trimmed === RETAIL_INVITE_RESUME_SEGMENT) return false
  return /^[A-Za-z0-9_-]{20,200}$/.test(trimmed)
}

export function maskEmailForUi(email: string | null | undefined): string | null {
  if (!email) return null
  const normalized = normalizeRetailInviteEmail(email)
  const at = normalized.indexOf("@")
  if (at <= 0) return null
  const local = normalized.slice(0, at)
  const domain = normalized.slice(at + 1)
  const localHint = local.length <= 2 ? `${local[0] ?? ""}…` : `${local.slice(0, 2)}…`
  return `${localHint}@${domain}`
}

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
  if (trimmed === RETAIL_INVITE_RESUME_PATH) return trimmed
  if (!RETAIL_INVITE_PATH.test(trimmed)) return null
  if (trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes("//")) return null
  return trimmed
}

export type RetailInvitationAccess = "ready" | "denied" | "unavailable"

/** Authenticated email must match. The raw token is not required for the resume route. */
export function classifyRetailInvitationForUser(input: {
  status: string
  expiresAt: string
  invitationEmail: string
  userEmail: string
  now?: Date
}): RetailInvitationAccess {
  if (normalizeRetailInviteEmail(input.invitationEmail) !== normalizeRetailInviteEmail(input.userEmail)) {
    return "denied"
  }
  if (input.status !== "pending") return "unavailable"
  if (new Date(input.expiresAt).getTime() <= (input.now ?? new Date()).getTime()) return "unavailable"
  return "ready"
}

export function retailInvitationTokenFromPath(path: string): string | null {
  if (path.trim() === RETAIL_INVITE_RESUME_PATH) return null
  const safe = safeRetailInviteNextPath(path)
  if (!safe || safe === RETAIL_INVITE_RESUME_PATH) return null
  const token = safe.slice("/retail/invite/".length)
  try {
    const decoded = decodeURIComponent(token)
    return isPlausibleRetailInviteToken(decoded) ? decoded : null
  } catch {
    return null
  }
}
