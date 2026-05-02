"use client"

import Link from "next/link"
import { useServiceSubscription } from "./ServiceSubscriptionContext"
import { buildServiceRoute } from "@/lib/service/routes"
import { SERVICE_TIER_LABEL } from "@/lib/serviceWorkspace/subscriptionTiers"

/**
 * TrialBanner — global Service workspace strip during an active free trial.
 *
 * Copy pattern: "14-day trial active · {tier} · {N days left | Last day}"
 */
export default function TrialBanner() {
  const { isTrialing, trialDaysLeft, tier, trialEndsAt, entitlementResolved, businessId } =
    useServiceSubscription()

  if (!entitlementResolved || !isTrialing) return null

  const tierLabel = SERVICE_TIER_LABEL[tier]
  const subscribeHref = buildServiceRoute("/service/settings/subscription", businessId ?? undefined)

  const daysSegment =
    trialDaysLeft === null
      ? null
      : trialDaysLeft <= 0
        ? "Last day"
        : trialDaysLeft === 1
          ? "1 day left"
          : `${trialDaysLeft} days left`

  const isUrgent = trialDaysLeft !== null && trialDaysLeft <= 3 && trialDaysLeft > 0

  return (
    <div
      className={`relative z-[41] border-b px-4 py-2.5 sm:px-6 ${
        isUrgent || (trialDaysLeft !== null && trialDaysLeft <= 0)
          ? "border-orange-200 bg-orange-50"
          : "border-blue-100 bg-blue-50"
      }`}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <svg
            className={`mt-0.5 h-4 w-4 shrink-0 ${isUrgent || trialDaysLeft === 0 ? "text-orange-500" : "text-blue-500"}`}
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
          <div
            className={`min-w-0 flex-1 text-sm leading-snug ${isUrgent || trialDaysLeft === 0 ? "text-orange-900" : "text-blue-900"}`}
          >
            <p className="break-words">
              <span className="font-semibold">14-day trial active</span>
              {" · "}
              <span className="font-medium">{tierLabel}</span>
              {daysSegment ? (
                <>
                  {" · "}
                  <span
                    className={
                      isUrgent || trialDaysLeft === 0 ? "font-semibold text-orange-800" : "font-medium text-blue-900"
                    }
                  >
                    {daysSegment}
                  </span>
                </>
              ) : null}
            </p>
            {trialEndsAt && (
              <p className={`mt-0.5 text-xs ${isUrgent || trialDaysLeft === 0 ? "text-orange-800" : "text-blue-800"}`}>
                Ends{" "}
                {trialEndsAt.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
        </div>
        <Link
          href={subscribeHref}
          className={`inline-flex shrink-0 items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:self-center ${
            isUrgent || trialDaysLeft === 0
              ? "bg-orange-600 text-white hover:bg-orange-700"
              : "bg-blue-600 text-white hover:bg-blue-700"
          } w-full sm:w-auto`}
        >
          Subscribe now
        </Link>
      </div>
    </div>
  )
}
