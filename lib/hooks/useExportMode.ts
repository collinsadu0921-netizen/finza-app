"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { useMemo } from "react"
import { pathnameIsExportRoute, searchParamsIndicateExport } from "@/lib/exportMode"

/**
 * Returns true when the current view is for export/print/preview:
 * - Route is /preview/*, /export/*, /print/*, /pdf/*, or /service/proposals/[id]/preview
 * - Query has ?print=true, ?export=true, or ?pdf=true
 *
 * Use to hide layout chrome (sidebar, nav) and UI controls so only document
 * content is shown. For actual printing, use CSS .print-hide / .export-hide
 * with @media print.
 */
export function useExportMode(): boolean {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  return useMemo(
    () => pathnameIsExportRoute(pathname) || searchParamsIndicateExport(searchParams),
    [pathname, searchParams]
  )
}
