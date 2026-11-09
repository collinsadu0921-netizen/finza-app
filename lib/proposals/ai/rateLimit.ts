const buckets = new Map<string, { count: number; resetAt: number }>()

const MAX_REQUESTS = Number(process.env.PROPOSAL_AI_MAX_REQUESTS_PER_MINUTE ?? 12)
const WINDOW_MS = 60_000

export function proposalAiRateLimitKey(userId: string, businessId: string): string {
  return `${userId}:${businessId}`
}

export function checkProposalAiRateLimit(
  userId: string,
  businessId: string
): { ok: true } | { ok: false; retryAfterSec: number } {
  const key = proposalAiRateLimitKey(userId, businessId)
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { ok: true }
  }
  if (bucket.count >= MAX_REQUESTS) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) }
  }
  bucket.count += 1
  return { ok: true }
}

/** Test helper only. */
export function resetProposalAiRateLimitForTests(): void {
  buckets.clear()
}
