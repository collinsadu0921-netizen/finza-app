import { isIP } from "node:net"

export type TrustedRequestMetadata = {
  ipAddress: string | null
  userAgent: string | null
}

const MAX_USER_AGENT_LENGTH = 500

/**
 * Capture request metadata at Finza's Next.js incoming boundary.
 *
 * Vercel appends the edge-observed peer to x-forwarded-for. We take the last
 * valid address rather than the first, because the first value can be supplied
 * by the caller. We deliberately do not fall back to x-real-ip: if a trusted
 * address cannot be established, audit metadata must stay NULL.
 *
 * This metadata must be passed into the database transaction explicitly. It
 * must not be read back from PostgREST request.headers.
 */
export function getTrustedRequestMetadata(request: Request): TrustedRequestMetadata {
  const forwarded = request.headers.get("x-forwarded-for")
  const candidates =
    forwarded
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? []

  let ipAddress: string | null = null
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (isIP(candidate)) {
      ipAddress = candidate
      break
    }
  }

  const rawUserAgent = request.headers.get("user-agent")?.trim() || null
  const userAgent = rawUserAgent
    ? rawUserAgent.slice(0, MAX_USER_AGENT_LENGTH)
    : null

  return { ipAddress, userAgent }
}
