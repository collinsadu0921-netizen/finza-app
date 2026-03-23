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
 * Wraps a page (or section) and shows an upgrade wall if the current
 * workspace tier is below `minTier`. Falls back to rendering children
 * when the subscription context hasn't loaded yet (loading state) or
 * when accessed outside a service workspace path (canAccessTier → true).
 */
export default function TierGate({ minTier, children }: TierGateProps) {
  const { canAccessTier, tier, loading } = useServiceSubscription()

  // While context is resolving render nothing to avoid flash of content
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
      </div>
    )
  }

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

  return <>{children}</>
}
