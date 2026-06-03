"use client"

import { useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { setSelectedBusinessId } from "@/lib/business"
import { replaceIfChanged } from "@/lib/navigation/safeReplace"

export function getUrlBusinessId(search: string): string | null {
  const params = new URLSearchParams(search)
  return params.get("business_id")?.trim() || params.get("businessId")?.trim() || null
}

/** Build a service-scoped URL, preserving unrelated query params. */
export function buildServiceScopedHref(
  pathname: string,
  input: {
    businessId: string
    preserveSearch?: string
    mutateParams?: (params: URLSearchParams) => void
  }
): string {
  const params = new URLSearchParams(input.preserveSearch ?? "")
  params.set("business_id", input.businessId)
  input.mutateParams?.(params)
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/**
 * Persist workspace selection and ensure `?business_id=` is present once on service routes.
 * No-op when the URL already matches.
 */
export function useSyncServiceBusinessIdInUrl(businessId: string | null | undefined): void {
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const searchParams = useSearchParams()
  const searchParamsString = searchParams.toString()

  useEffect(() => {
    const bid = businessId?.trim()
    if (!bid) return
    if (!pathname.startsWith("/service/") && pathname !== "/recurring/create") return

    setSelectedBusinessId(bid)

    const targetHref = buildServiceScopedHref(pathname, {
      businessId: bid,
      preserveSearch: searchParamsString,
    })

    replaceIfChanged(router, pathname, searchParamsString, targetHref)
  }, [businessId, pathname, searchParamsString, router])
}
