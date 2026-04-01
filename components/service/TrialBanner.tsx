"use client"

import Link from "next/link"
import { useServiceSubscription } from "./ServiceSubscriptionContext"
import { SERVICE_TIER_LABEL } from "@/lib/serviceWorkspace/subscriptionTiers"

/**
 * TrialBanner
 *
 * Persistent top-of-page banner shown during an active free trial.
 * Renders nothing when the user is not on a trial or when loading.
 *
 * Examples:
 *   "Essentials trial — 14 days left · Subscribe now"
 *   "Professional trial — 1 day left · Subscribe now"
 *   "Business trial — Last day · Subscribe now"
 */
export default function TrialBanner() {
  const { isTrialing, trialDaysLeft, tier, entitlementResolved } = useServiceSubscription()

  if (!entitlementResolved || !isTrialing) return null

  const tierLabel = SERVICE_TIER_LABEL[tier]
  const daysText =
    trialDaysLeft === null
      ? ""
      : trialDaysLeft === 0
      ? "Last day"
      : trialDaysLeft === 1
      ? "1 day left"
      : `${trialDaysLeft} days left`

  const isUrgent = trialDaysLeft !== null && trialDaysLeft <= 3

  return (
    <div
      className={`border-b px-4 py-2.5 ${
        isUrgent
          ? "border-orange-200 bg-orange-50"
          : "border-blue-100 bg-blue-50"
      }`}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <svg
            className={`h-4 w-4 shrink-0 ${isUrgent ? "text-orange-500" : "text-blue-500"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className={`text-sm ${isUrgent ? "text-orange-800" : "text-blue-800"}`}>
            <span className="font-semibold">{tierLabel} trial</span>
            {daysText && (
              <>
                {" "}—{" "}
                <span className={isUrgent ? "font-semibold text-orange-700" : ""}>{daysText}</span>
              </>
            )}
          </p>
        </div>
        <Link
          href="/service/settings/subscription"
          className={`shrink-0 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
            isUrgent
              ? "bg-orange-600 text-white hover:bg-orange-700"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          Subscribe now
        </Link>
      </div>
    </div>
  )
}
