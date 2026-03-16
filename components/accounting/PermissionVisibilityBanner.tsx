"use client"

import { useAccountingBusiness } from "@/lib/accounting/useAccountingBusiness"
import { useAccountingAuthority } from "@/lib/accounting/useAccountingAuthority"
import { EngagementStatusBadge } from "@/components/EngagementStatusBadge"

const PERMISSION_LABELS: Record<string, string> = {
  read: "Read Only",
  write: "Write Access",
  approve: "Approval Authority",
}

const PERMISSION_TOOLTIPS: Record<string, string> = {
  read: "View records only",
  write: "Can create drafts",
  approve: "Can post & reverse entries",
}

export default function PermissionVisibilityBanner() {
  const { businessId } = useAccountingBusiness()
  const { authority_source, access_level, engagement_status, loading } = useAccountingAuthority(businessId)

  if (loading || authority_source !== "accountant" || !businessId) {
    return null
  }

  const level = access_level && ["read", "write", "approve"].includes(access_level) ? access_level : "read"
  const status = (engagement_status ?? "").toLowerCase()

  return (
    <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm">
      <span className="text-gray-500 dark:text-gray-400 font-medium">Your access</span>
      <span
        title={PERMISSION_TOOLTIPS[level] ?? ""}
        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 cursor-help"
      >
        {PERMISSION_LABELS[level] ?? level}
      </span>
      <span className="text-gray-400 dark:text-gray-500">·</span>
      <EngagementStatusBadge status={status || undefined} />
    </div>
  )
}
