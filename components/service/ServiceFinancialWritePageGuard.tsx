"use client"

import { useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { replaceIfChanged } from "@/lib/navigation/safeReplace"
import { useServiceFinancialWrite } from "@/components/service/useServiceFinancialWrite"
import type { ServiceFinancialWriteScope } from "@/components/service/useServiceFinancialWrite"
import ServiceReadOnlyNotice from "@/components/service/ServiceReadOnlyNotice"

type Props = {
  scope?: ServiceFinancialWriteScope
  /** Where to send the user when this create/edit page is blocked */
  backHref: string
  children: React.ReactNode
}

/**
 * Blocks create/edit pages for read-only workspaces (redirect + notice).
 */
export function ServiceFinancialWritePageGuard({
  scope = "default",
  backHref,
  children,
}: Props) {
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const searchParamsString = useSearchParams().toString()
  const { readOnly, entitlementResolved } = useServiceFinancialWrite(scope)

  useEffect(() => {
    if (entitlementResolved && readOnly) {
      replaceIfChanged(router, pathname, searchParamsString, backHref)
    }
  }, [entitlementResolved, readOnly, backHref, pathname, searchParamsString, router])

  if (!entitlementResolved) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-slate-500 text-sm">
        Checking workspace access…
      </div>
    )
  }

  if (readOnly) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <ServiceReadOnlyNotice scope={scope} />
      </div>
    )
  }

  return <>{children}</>
}
