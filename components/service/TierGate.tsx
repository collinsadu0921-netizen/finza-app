"use client"

import Link from "next/link"
import { useServiceSubscription } from "./ServiceSubscriptionContext"
import TrialBanner from "./TrialBanner"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import { SERVICE_TIER_LABEL } from "@/lib/serviceWorkspace/subscriptionTiers"

type TierGateProps = {
  minTier: ServiceSubscriptionTier
  children: React.ReactNode
}

/**
 * Page-level tier + subscription enforcement.
 *
 * Priority (highest to lowest):
 * 1. subscriptionLocked — MoMo renewal grace period has expired.
 *    Hard payment wall, all gated content blocked.
 *
 * 2. !canAccessTier — effectiveTier < minTier.
 *    Amber upgrade wall.
 *    NOTE: trial expiry is handled HERE, not with a separate wall.
 *    When a trial ends, resolveServiceEntitlement() downgrades effectiveTier
 *    to 'starter'. If the page requires a higher tier, this gate fires and the
 *    upgrade wall copy explains what happened.
 *
 * 3. inGracePeriod — MoMo payment failed, 3-day grace window still open.
 *    Renders children + amber payment-warning banner.
 *
 * 4. isTrialing — active free trial.
 *    Renders children + blue TrialBanner countdown.
 *
 * 5. Normal — no decoration.
 *
 * Falls back to rendering children while context is loading to avoid a flash
 * of the wall when the subscription state is being fetched.
 */
export default function TierGate({ minTier, children }: TierGateProps) {
  const {
    canAccessTier,
    effectiveTier,
    tier: rawTier,
    trialExpired,
    entitlementResolved,
    isTrialing,
    inGracePeriod,
    periodExpired,
    graceEndsAt,
    subscriptionLocked,
  } = useServiceSubscription()

  // Avoid upgrade-wall flash while default starter entitlement is still stale; server routes must enforce access.
  if (!entitlementResolved) {
    return <>{children}</>
  }

  // --- 1. Payment locked (MoMo grace period expired) ---
  if (subscriptionLocked) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm text-center">
          <div className="mb-5 flex justify-center">
            <div className="rounded-full bg-red-50 p-4 ring-8 ring-red-50/50">
              <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
          </div>
          <h2 className="text-xl font-bold text-slate-900">Subscription payment overdue</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Your Mobile Money payment failed and the 3-day grace period has expired.
            Renew your subscription to restore access.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <Link
              href="/service/settings/subscription"
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              Renew subscription
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
            <Link href="/service/dashboard" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // --- 2. Effective tier too low (includes post-trial-expiry downgrade) ---
  if (!canAccessTier(minTier)) {
    const requiredLabel = SERVICE_TIER_LABEL[minTier]
    const currentLabel  = SERVICE_TIER_LABEL[effectiveTier]

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm text-center">
          <div className="mb-5 flex justify-center">
            <div className="rounded-full bg-amber-50 p-4 ring-8 ring-amber-50/50">
              <svg className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>

          {trialExpired ? (
            <>
              <h2 className="text-xl font-bold text-slate-900">Your free trial has ended</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Your 14-day trial expired. Subscribe to restore access to{" "}
                <span className="font-medium text-slate-700">{requiredLabel}</span> features.
                Your data is safe and waiting for you.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-slate-900">
                {requiredLabel} plan required
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                This feature is included in the{" "}
                <span className="font-medium text-slate-700">{requiredLabel}</span>{" "}
                plan and above. You are currently on the{" "}
                <span className="font-medium text-slate-700">{currentLabel}</span> plan.
              </p>
            </>
          )}

          <div className="mt-6 flex flex-col items-center gap-3">
            <Link
              href="/service/settings/subscription"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
            >
              {trialExpired ? "View plans & subscribe" : "View plans & upgrade"}
            </Link>
            <Link href="/service/dashboard" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // --- 3. Grace period: period expired OR MoMo payment failed ---
  if (inGracePeriod) {
    const graceEndFormatted = graceEndsAt
      ? graceEndsAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
      : null

    return (
      <>
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            {periodExpired ? (
              <p className="text-sm text-amber-800">
                <span className="font-semibold">Your subscription period has ended.</span>{" "}
                You have limited time to renew.
                {graceEndFormatted && (
                  <> Access is available until <span className="font-medium">{graceEndFormatted}</span>.</>
                )}{" "}
                <Link href="/service/settings/subscription" className="underline hover:text-amber-900">
                  Renew now
                </Link>.
              </p>
            ) : (
              <p className="text-sm text-amber-800">
                <span className="font-semibold">Payment failed.</span> Your Mobile Money renewal
                did not go through. Renew within the 3-day grace period to avoid losing access.
                {graceEndFormatted && (
                  <> Grace period ends <span className="font-medium">{graceEndFormatted}</span>.</>
                )}{" "}
                <Link href="/service/settings/subscription" className="underline hover:text-amber-900">
                  Renew now
                </Link>.
              </p>
            )}
          </div>
        </div>
        {children}
      </>
    )
  }

  // --- 4. Active trial — show countdown banner above content ---
  if (isTrialing) {
    return (
      <>
        <TrialBanner />
        {children}
      </>
    )
  }

  // --- 5. Normal paid subscription ---
  return <>{children}</>
}
