"use client"

import Link from "next/link"
import { useServiceFinancialWrite } from "@/components/service/useServiceFinancialWrite"
import type { ServiceFinancialWriteScope } from "@/components/service/useServiceFinancialWrite"

type Props = {
  scope?: ServiceFinancialWriteScope
  message?: string
  className?: string
  compact?: boolean
}

/**
 * Inline notice when the workspace cannot mutate financial records.
 * Renders nothing when writes are allowed or entitlement is still loading.
 */
export default function ServiceReadOnlyNotice({
  scope = "default",
  message: messageOverride,
  className = "",
  compact = false,
}: Props) {
  const { readOnly, message, upgradeHref } = useServiceFinancialWrite(scope)
  if (!readOnly) return null

  const text = messageOverride ?? message

  if (compact) {
    return (
      <p className={`text-sm text-amber-800 ${className}`}>
        {text}{" "}
        <Link href={upgradeHref} className="font-semibold underline hover:text-amber-900">
          Upgrade
        </Link>
      </p>
    )
  }

  return (
    <div
      className={`rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${className}`}
      role="status"
    >
      <p>{text}</p>
      <Link
        href={upgradeHref}
        className="mt-2 inline-flex text-sm font-semibold text-amber-950 underline hover:text-amber-900"
      >
        View plans &amp; upgrade
      </Link>
    </div>
  )
}
