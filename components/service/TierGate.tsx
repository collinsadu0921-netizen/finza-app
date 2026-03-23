"use client"

import Link from "next/link"
import { useServiceSubscription } from "./ServiceSubscriptionContext"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import { SERVICE_TIER_LABEL } from "@/lib/serviceWorkspace/subscriptionTiers"

type TierGateProps = {
  minTier: ServiceSubscriptionTier
  children: React.ReactNode
}

/**
 * Page-level tier enforcement.
 *
 * Priority (highest to lowest):
 * 1. subscriptionLocked  — MoMo payment grace period has expired. Shows a
 *    payment-failure wall regardless of tier, blocking all gated content.
 * 2. !canAccessTier      — Workspace tier is below minTier. Shows upgrade wall.
 * 3. inGracePeriod       — MoMo payment failed but 3-day grace window is still
 *    open. Renders children with an amber warning banner.
 * 4. Normal              — Renders children with no decoration.
 *
 * Falls back to rendering children while the subscription context is loading
 * to avoid a flash of the wall when the tier is being fetched.
 */
export default function TierGate({ minTier, children }: TierGateProps) {
  const { canAccessTier, tier, loading, inGracePeriod, subscriptionLocked } =
    useServiceSubscription()

  // While context is resolving render nothing to avoid flash of content
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
      </div>
    )
  }

  // --- Payment locked (grace period expired) ---
  if (subscriptionLocked) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm text-center">
          <div className="mb-5 flex justify-center">
            <div className="rounded-full bg-red-50 p-4 ring-8 ring-red-50/50">
              <svg
                className="h-8 w-8 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
            </div>
          </div>
          <h2 className="text-xl font-bold text-slate-900">Subscription payment overdue</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Your Mobile Money payment failed and the 3-day grace period has expired. Please
            renew your subscription to restore access.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <a
              href="mailto:hello@finza.app?subject=Subscription%20renewal"
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              Contact us to renew
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <Link
              href="/service/dashboard"
              className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // --- Tier upgrade wall ---
  if (!canAccessTier(minTier)) {
    const requiredLabel = SERVICE_TIER_LABEL[minTier]
    const currentLabel  = SERVICE_TIER_LABEL[tier]

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm text-center">
          {/* lock icon */}
          <div className="mb-5 flex justify-center">
            <div className="rounded-full bg-amber-50 p-4 ring-8 ring-amber-50/50">
              <svg
                className="h-8 w-8 text-amber-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
          </div>

          <h2 className="text-xl font-bold text-slate-900">
            {requiredLabel} plan required
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            This feature is included in the{" "}
            <span className="font-medium text-slate-700">{requiredLabel}</span>{" "}
            plan and above. You are currently on the{" "}
            <span className="font-medium text-slate-700">{currentLabel}</span> plan.
          </p>

          <div className="mt-6 flex flex-col items-center gap-3">
            <Link
              href="/service/settings/subscription"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
            >
              View plans & upgrade
            </Link>
            <Link
              href="/service/dashboard"
              className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // --- Grace period warning banner (still within 3-day window) ---
  if (inGracePeriod) {
    return (
      <>
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <svg
              className="h-4 w-4 shrink-0 text-amber-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
            <p className="text-sm text-amber-800">
              <span className="font-semibold">Payment failed.</span> Your Mobile Money renewal
              payment did not go through. Please renew within the 3-day grace period to avoid
              losing access.{" "}
              <a
                href="mailto:hello@finza.app?subject=Subscription%20renewal"
                className="underline hover:text-amber-900"
              >
                Contact us to renew
              </a>
              .
            </p>
          </div>
        </div>
        {children}
      </>
    )
  }

  return <>{children}</>
}
