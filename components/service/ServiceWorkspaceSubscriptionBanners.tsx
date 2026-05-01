"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useServiceSubscription } from "@/components/service/ServiceSubscriptionContext"
import TrialBanner from "@/components/service/TrialBanner"
import { buildServiceRoute } from "@/lib/service/routes"
import { shouldMountServiceSubscriptionProvider } from "@/lib/serviceWorkspace/serviceSubscriptionSurface"

function formatDayCount(days: number): string {
  if (days <= 0) return "today"
  if (days === 1) return "1 day"
  return `${days} days`
}

function graceDaysRemaining(graceEndsAt: Date | null): number | null {
  if (!graceEndsAt) return null
  const ms = graceEndsAt.getTime() - Date.now()
  if (ms <= 0) return 0
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

/**
 * Service workspace only: trial, payment grace, and subscription lock alerts.
 * Mounted once under {@link ServiceSubscriptionProvider} in ProtectedLayout.
 */
export default function ServiceWorkspaceSubscriptionBanners() {
  const pathname = usePathname()
  const {
    businessId,
    entitlementResolved,
    isTrialing,
    inGracePeriod,
    periodExpired,
    graceEndsAt,
    subscriptionLocked,
  } = useServiceSubscription()

  if (!shouldMountServiceSubscriptionProvider(pathname)) return null
  if (!entitlementResolved) return null

  const subHref = buildServiceRoute("/service/settings/subscription", businessId ?? undefined)
  const graceEndFormatted = graceEndsAt
    ? graceEndsAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null
  const graceDays = graceDaysRemaining(graceEndsAt)

  return (
    <div className="export-hide print-hide">
      {subscriptionLocked && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2.5">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-red-800">
              <span className="font-semibold">Subscription payment overdue.</span>{" "}
              Renew to restore full access to your workspace.
            </p>
            <Link
              href={subHref}
              className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              Renew subscription
            </Link>
          </div>
        </div>
      )}

      {!subscriptionLocked && inGracePeriod && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-amber-900">
              {periodExpired ? (
                <>
                  <span className="font-semibold">Your billing period has ended.</span> Renew soon to avoid interruption.
                  {graceEndFormatted && (
                    <>
                      {" "}
                      Access continues until{" "}
                      <span className="font-medium">{graceEndFormatted}</span>
                      {graceDays != null && graceDays > 0 && (
                        <> ({formatDayCount(graceDays)} remaining)</>
                      )}
                      .
                    </>
                  )}
                </>
              ) : (
                <>
                  <span className="font-semibold">Payment overdue.</span> Your renewal did not complete.
                  {graceEndFormatted && (
                    <>
                      {" "}
                      Grace period ends{" "}
                      <span className="font-medium">{graceEndFormatted}</span>
                      {graceDays != null && graceDays > 0 && (
                        <> — {formatDayCount(graceDays)} left</>
                      )}
                      .
                    </>
                  )}
                </>
              )}{" "}
              <Link href={subHref} className="font-semibold underline hover:text-amber-950">
                Pay now
              </Link>
            </p>
          </div>
        </div>
      )}

      {isTrialing && <TrialBanner />}
    </div>
  )
}
