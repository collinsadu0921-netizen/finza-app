"use client"

import { useServiceSubscription } from "@/components/service/ServiceSubscriptionContext"
import {
  SERVICE_TIER_LABEL,
  SERVICE_TIER_RANK,
  nextTier,
  type ServiceSubscriptionTier,
} from "@/lib/serviceWorkspace/subscriptionTiers"
import Link from "next/link"

type TierFeatures = {
  section: string
  items: string[]
}

const TIER_FEATURES: Record<ServiceSubscriptionTier, TierFeatures[]> = {
  starter: [
    {
      section: "Operations",
      items: ["Dashboard", "Customers", "Quotes", "Services"],
    },
    {
      section: "Billing",
      items: ["Proforma Invoices", "Invoices", "Payments", "Credit Notes", "Expenses"],
    },
    {
      section: "Reports",
      items: ["Profit & Loss", "Balance Sheet"],
    },
    {
      section: "Tax",
      items: ["VAT Report"],
    },
    {
      section: "Settings",
      items: ["Business Profile", "Invoice Settings", "Payment Settings", "WhatsApp Integration"],
    },
  ],
  professional: [
    {
      section: "Everything in Essentials, plus:",
      items: [
        "Projects",
        "Materials",
        "Supplier Bills",
        "Payroll & Salary Advances",
        "Fixed Assets",
        "Cash Flow Statement",
        "Changes in Equity Report",
        "VAT Returns",
        "WHT Returns",
        "Automations",
        "Team Members",
        "Staff Management",
        "Accountant Requests",
        "Accounting Activity Log",
      ],
    },
  ],
  business: [
    {
      section: "Everything in Professional, plus:",
      items: [
        "General Ledger",
        "Chart of Accounts",
        "Trial Balance",
        "Reconciliation",
        "Bank Reconciliation",
        "Accounting Periods",
        "Loans & Equity",
        "CIT Provisions",
        "Full System Audit Log",
      ],
    },
  ],
}

const TIER_COLOR: Record<ServiceSubscriptionTier, string> = {
  starter:      "border-slate-200 bg-white",
  professional: "border-blue-200 bg-blue-50",
  business:     "border-purple-200 bg-purple-50",
}

const TIER_BADGE: Record<ServiceSubscriptionTier, string> = {
  starter:      "bg-slate-100 text-slate-700",
  professional: "bg-blue-100 text-blue-700",
  business:     "bg-purple-100 text-purple-700",
}

const TIER_ORDER: ServiceSubscriptionTier[] = ["starter", "professional", "business"]

export default function SubscriptionPage() {
  const { tier, loading } = useServiceSubscription()

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-10">

        {/* Header */}
        <div className="mb-8">
          <Link
            href="/service/settings/business-profile"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Settings
          </Link>
          <h1 className="text-xl font-bold text-slate-900">Subscription & Plan</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your plan determines which features are available in your workspace.
          </p>
        </div>

        {/* Current plan banner */}
        <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current plan</p>
              {loading ? (
                <div className="mt-1 h-7 w-36 animate-pulse rounded-md bg-slate-100" />
              ) : (
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {SERVICE_TIER_LABEL[tier]}
                </p>
              )}
            </div>
            {!loading && nextTier(tier) && (
              <a
                href="mailto:hello@finza.app?subject=Upgrade%20request"
                className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
              >
                Upgrade to {SERVICE_TIER_LABEL[nextTier(tier)!]}
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            )}
            {!loading && !nextTier(tier) && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Highest plan
              </span>
            )}
          </div>
        </div>

        {/* Plan comparison cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          {TIER_ORDER.map((t) => {
            const isCurrent = t === tier
            const isLocked  = !loading && SERVICE_TIER_RANK[t] > SERVICE_TIER_RANK[tier]
            const features  = TIER_FEATURES[t]

            return (
              <div
                key={t}
                className={`relative rounded-xl border p-5 shadow-sm ${TIER_COLOR[t]} ${
                  isCurrent ? "ring-2 ring-slate-800" : ""
                }`}
              >
                {isCurrent && (
                  <span className="absolute -top-2.5 left-4 rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                    Current
                  </span>
                )}

                <div className="mb-4">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${TIER_BADGE[t]}`}>
                    {SERVICE_TIER_LABEL[t]}
                  </span>
                  {isLocked && (
                    <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-slate-400">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Upgrade required
                    </span>
                  )}
                </div>

                {features.map((group) => (
                  <div key={group.section} className="mb-3">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {group.section}
                    </p>
                    <ul className="space-y-1">
                      {group.items.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm text-slate-700">
                          <svg
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                {isLocked && (
                  <a
                    href="mailto:hello@finza.app?subject=Upgrade%20request"
                    className="mt-4 block w-full rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Contact us to upgrade
                  </a>
                )}
              </div>
            )
          })}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          To change your plan, contact us at{" "}
          <a href="mailto:hello@finza.app" className="underline hover:text-slate-600">
            hello@finza.app
          </a>
          .
        </p>
      </div>
    </div>
  )
}
