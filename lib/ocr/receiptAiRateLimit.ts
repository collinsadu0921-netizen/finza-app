/**
 * Same in-memory window as Finza Assist, with a tighter cap because each call
 * sends a receipt to a paid vision model. Not a distributed limiter.
 */
const rateBucket = new Map<string, { count: number; resetAt: number }>()
const RATE_MAX = 8
const RATE_WINDOW_MS = 60_000

export function checkReceiptAiRateLimit(userId: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now()
  const row = rateBucket.get(userId)
  if (!row || now > row.resetAt) {
    rateBucket.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return { ok: true }
  }
  if (row.count >= RATE_MAX) {
    return { ok: false, retryAfterSec: Math.ceil((row.resetAt - now) / 1000) }
  }
  row.count += 1
  return { ok: true }
}

export function resetReceiptAiRateLimitForTests(): void {
  rateBucket.clear()
}
