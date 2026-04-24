/**
 * Normalize mailbox strings for routing lookups (stored lowercase on business_inbound_email_routes).
 */

export function normalizeRecipientAddress(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  return raw.trim().toLowerCase()
}

/** Extract bare email from `Name <addr@x.com>` or return trimmed lowercased string. */
export function parseMailboxEmail(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  const trimmed = raw.trim()
  const angle = trimmed.match(/<([^>]+@[^>]+)>/)
  const addr = (angle?.[1] ?? trimmed).trim().toLowerCase()
  return addr || null
}
