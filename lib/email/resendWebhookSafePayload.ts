import { createHash } from "node:crypto"

/** Event types we persist (Resend `type` field). */
export const TRACKED_RESEND_EMAIL_EVENT_TYPES = new Set([
  "email.bounced",
  "email.complained",
  "email.delivered",
  "email.opened",
  "email.clicked",
])

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isLikelyUuid(value: string): boolean {
  return UUID_RE.test(value.trim())
}

/**
 * Reads `finza_business_id` from Resend tag object (echoed on webhook payloads).
 * Does not interpret other tag keys as business scope.
 */
export function extractFinzaBusinessIdFromTags(tags: unknown): string | null {
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) return null
  const raw = (tags as Record<string, unknown>)["finza_business_id"]
  if (typeof raw !== "string") return null
  const v = raw.trim()
  return isLikelyUuid(v) ? v.toLowerCase() : null
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

/**
 * Allow-list tag keys we may store (no recipient-derived keys).
 * Values are copied as short strings (truncate).
 */
const FINZA_TAG_PREFIX = "finza_"
const MAX_TAG_VALUE_LEN = 128

function pickAllowlistedTags(tags: unknown): Record<string, string> | undefined {
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(tags as Record<string, unknown>)) {
    if (k === "finza_business_id") continue
    if (!k.startsWith(FINZA_TAG_PREFIX)) continue
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue
    const s = String(v).trim().slice(0, MAX_TAG_VALUE_LEN)
    if (s) out[k] = s
  }
  return Object.keys(out).length ? out : undefined
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Minimal, non-identifying payload for DB storage.
 * Never includes to, from, subject, raw links, IP, or user-agent.
 */
export function buildResendWebhookSafePayload(
  eventType: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const emailId = typeof data.email_id === "string" ? data.email_id : undefined
  const broadcastId = typeof data.broadcast_id === "string" ? data.broadcast_id : undefined
  const templateId = typeof data.template_id === "string" ? data.template_id : undefined
  const tags = pickAllowlistedTags(data.tags)

  const base: Record<string, unknown> = {}
  if (emailId) base.email_id = emailId
  if (broadcastId) base.broadcast_id = broadcastId
  if (templateId) base.template_id = templateId
  if (tags) base.finza_tags = tags

  if (eventType === "email.bounced") {
    const bounce = asRecord(data.bounce)
    if (bounce) {
      const type = typeof bounce.type === "string" ? bounce.type : undefined
      const subType = typeof bounce.subType === "string" ? bounce.subType : undefined
      // Omit bounce.message — provider text can include recipient-identifying details.
      base.bounce = {
        ...(type ? { type } : {}),
        ...(subType ? { subType } : {}),
      }
    }
    return base
  }

  if (eventType === "email.complained") {
    base.complained = true
    return base
  }

  if (eventType === "email.delivered") {
    base.delivered = true
    return base
  }

  if (eventType === "email.opened") {
    const open = asRecord(data.open)
    const ts =
      (open && typeof open.timestamp === "string" && open.timestamp) ||
      (typeof data.created_at === "string" ? data.created_at : undefined)
    base.opened = true
    if (ts) base.opened_at = ts
    return base
  }

  if (eventType === "email.clicked") {
    const click = asRecord(data.click)
    const link = click && typeof click.link === "string" ? click.link : undefined
    const ts =
      (click && typeof click.timestamp === "string" && click.timestamp) ||
      (typeof data.created_at === "string" ? data.created_at : undefined)
    base.clicked = true
    if (link) base.link_sha256 = sha256Hex(link)
    if (ts) base.clicked_at = ts
    return base
  }

  return base
}

export function parseEventOccurredAt(data: Record<string, unknown>): string | null {
  if (typeof data.created_at === "string" && data.created_at) return data.created_at
  return null
}
