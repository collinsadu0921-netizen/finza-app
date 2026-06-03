"use client"

import Link from "next/link"
import { useServiceSubscription } from "./ServiceSubscriptionContext"
import { buildServiceRoute } from "@/lib/service/routes"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import { SERVICE_TIER_LABEL } from "@/lib/serviceWorkspace/subscriptionTiers"

type TierGateProps = {
  minTier: ServiceSubscriptionTier
  children: React.ReactNode
}

/**
 * Page-level tier enforcement. Read-only subscription lock does NOT block page
 * views — banners + API write guards handle mutations. Users can still browse data.
 */
export default function TierGate({ minTier, children }: TierGateProps) {
  const {
    canAccessTier,
    effectiveTier,
    trialExpired,
    trialGraceActive,
    entitlementResolved,
    businessId,
  } = useServiceSubscription()

  const subscriptionHref = buildServiceRoute(
    "/service/settings/subscription",
    businessId ?? undefined
  )

  if (!entitlementResolved) {
    return (
      <div
        className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 py-12 text-slate-500"
        role="status"
        aria-live="polite"
      >
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600"
          aria-hidden
        />
        <p className="text-sm">Checking your plan access…</p>
      </div>
    )
  }

  if (!canAccessTier(minTier)) {
    const requiredLabel = SERVICE_TIER_LABEL[minTier]
    const currentLabel = SERVICE_TIER_LABEL[effectiveTier]

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm text-center">
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

          {trialExpired && !trialGraceActive ? (
            <>
              <h2 className="text-xl font-bold text-slate-900">
                Your free trial has ended
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Subscribe to access{" "}
                <span className="font-medium text-slate-700">{requiredLabel}</span>{" "}
                features. Your data is safe and waiting for you.
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
                <span className="font-medium text-slate-700">{currentLabel}</span>{" "}
                plan.
              </p>
            </>
          )}

          <div className="mt-6 flex flex-col items-center gap-3">
            <Link
              href={subscriptionHref}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
            >
              {trialExpired ? "View plans & subscribe" : "View plans & upgrade"}
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
