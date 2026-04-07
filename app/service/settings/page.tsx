"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useMemo } from "react"
import { useServiceSubscription } from "@/components/service/ServiceSubscriptionContext"
import { buildServiceRoute } from "@/lib/service/routes"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import { upgradeLabel } from "@/lib/serviceWorkspace/subscriptionTiers"

type SettingsLink = {
  label: string
  path: string
  minTier?: ServiceSubscriptionTier
  /** Use workspace business_id in query (journal activity). */
  withWorkspaceId?: boolean
}

type SettingsGroup = {
  title: string
  description: string
  links: SettingsLink[]
}

const SETTING_GROUPS: SettingsGroup[] = [
  {
    title: "Workspace",
    description: "Business identity, plan, and billing.",
    links: [
      { label: "Business profile", path: "/service/settings/business-profile" },
      { label: "Subscription & plan", path: "/service/settings/subscription" },
    ],
  },
  {
    title: "Invoices & payments",
    description: "What customers see on PDFs and emails, versus connections that collect money.",
    links: [
      { label: "Invoices & quotes (appearance)", path: "/service/settings/invoice-settings" },
      { label: "Payment integrations", path: "/service/settings/payments" },
      {
        label: "WhatsApp message templates",
        path: "/settings/communication/whatsapp",
      },
    ],
  },
]

function Chevron() {
  return (
    <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

export default function ServiceSettingsHubPage() {
  const searchParams = useSearchParams()
  const urlBusinessId = searchParams.get("business_id")?.trim() ?? null
  const { businessId: contextBusinessId, canAccessTier } = useServiceSubscription()

  const workspaceId = useMemo(
    () => urlBusinessId ?? contextBusinessId,
    [urlBusinessId, contextBusinessId]
  )

  const hrefFor = (link: SettingsLink) => {
    if (!workspaceId) return link.path
    if (link.withWorkspaceId) return buildServiceRoute(link.path, workspaceId)
    if (link.path.startsWith("/service")) return buildServiceRoute(link.path, workspaceId)
    if (link.path === "/audit-log") return buildServiceRoute(link.path, workspaceId)
    return link.path
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-slate-900">Settings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Everything for your workspace in one place. Open a section below.
          </p>
        </div>

        <div className="space-y-6">
          {SETTING_GROUPS.map((group) => (
            <section
              key={group.title}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 className="text-sm font-semibold text-slate-900">{group.title}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{group.description}</p>
              <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
                {group.links.map((link) => {
                  const locked = link.minTier != null && !canAccessTier(link.minTier)
                  const href = hrefFor(link)
                  return (
                    <li key={link.path + link.label}>
                      {locked ? (
                        <div className="flex items-center justify-between gap-3 py-3 text-sm text-slate-400">
                          <span>{link.label}</span>
                          <span className="shrink-0 text-[11px] font-medium text-amber-700">
                            {upgradeLabel(link.minTier!)}
                          </span>
                        </div>
                      ) : (
                        <Link
                          href={href}
                          className="flex items-center justify-between gap-3 py-3 text-sm font-medium text-slate-700 transition-colors hover:text-slate-900"
                        >
                          {link.label}
                          <Chevron />
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
