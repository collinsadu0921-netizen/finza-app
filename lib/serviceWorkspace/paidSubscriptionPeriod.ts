/**
 * Deterministic paid-subscription grace.
 *
 * Invariant (TypeScript and PostgreSQL must agree):
 *   paid grace deadline = current_period_ends_at + 3 days
 *   now <  grace_end  => grace active
 *   now >= grace_end  => expired / read-only
 *
 * Failed payments must never move this deadline. Cron state is
 * normalization, not the security boundary.
 */
import type { ServiceSubscriptionStatus } from "@/lib/serviceWorkspace/subscriptionTiers"

export const PAID_POST_EXPIRY_GRACE_DAYS = 3
export const PAID_POST_EXPIRY_GRACE_MS =
  PAID_POST_EXPIRY_GRACE_DAYS * 24 * 60 * 60 * 1000

export function isPaidSubscriptionWithKnownPeriod(
  subscriptionStartedAt: Date | null,
  periodEndsAt: Date | null
): boolean {
  return subscriptionStartedAt !== null && periodEndsAt !== null
}

export function deterministicPaidGraceEnd(periodEndsAt: Date): Date {
  return new Date(periodEndsAt.getTime() + PAID_POST_EXPIRY_GRACE_MS)
}

export type PaidPeriodClock = {
  isPaidWithKnownPeriod: boolean
  paidPeriodExpired: boolean
  deterministicPaidGraceEnd: Date | null
  paidGraceActive: boolean
  paidGraceExpired: boolean
}

export function resolvePaidPeriodClock(opts: {
  now: Date
  subscriptionStartedAt: Date | null
  periodEndsAt: Date | null
  status: ServiceSubscriptionStatus
}): PaidPeriodClock {
  const { now, subscriptionStartedAt, periodEndsAt, status } = opts

  if (!isPaidSubscriptionWithKnownPeriod(subscriptionStartedAt, periodEndsAt) || !periodEndsAt) {
    return {
      isPaidWithKnownPeriod: false,
      paidPeriodExpired: false,
      deterministicPaidGraceEnd: null,
      paidGraceActive: false,
      paidGraceExpired: false,
    }
  }

  const graceEnd = deterministicPaidGraceEnd(periodEndsAt)
  const paidPeriodExpired = now.getTime() >= periodEndsAt.getTime()
  const paidGraceActive =
    paidPeriodExpired && now.getTime() < graceEnd.getTime() && status !== "locked"
  const paidGraceExpired =
    paidPeriodExpired && now.getTime() >= graceEnd.getTime()

  return {
    isPaidWithKnownPeriod: true,
    paidPeriodExpired,
    deterministicPaidGraceEnd: graceEnd,
    paidGraceActive,
    paidGraceExpired,
  }
}

export function lifecycleKeyPaidPeriod(
  periodEndsAtIso: string,
  businessId: string
): string {
  return `${periodEndsAtIso}|${businessId}`
}

export function sameTimestamp(a: string | null | undefined, b: string): boolean {
  if (!a) return false
  const left = new Date(a).getTime()
  const right = new Date(b).getTime()
  return !Number.isNaN(left) && !Number.isNaN(right) && left === right
}
