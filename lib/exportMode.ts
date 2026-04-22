/**
 * Export / Print mode detection for document previews and PDF output.
 * When true, UI controls (sidebar, nav, buttons, toolbars) must be hidden
 * so only document content is shown.
 *
 * Priority:
 * 1. Route: /preview/*, /export/*, /print/*, /pdf/*, and /service/proposals/[id]/preview
 * 2. Query: ?print=true, ?export=true, ?pdf=true
 * 3. CSS @media print (handled via global .print-hide class; hook exposes isPrintMedia for optional use)
 */

export const EXPORT_MODE_ROUTE_PREFIXES = ["/preview", "/export", "/print", "/pdf"] as const

export function pathnameIsExportRoute(pathname: string | null): boolean {
  if (!pathname) return false
  if (EXPORT_MODE_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true
  const p = pathname.replace(/\/$/, "") || ""
  /* Staff proposal client preview — hide dashboard chrome like other document preview routes */
  if (/\/service\/proposals\/[^/]+\/preview$/.test(p)) return true
  return false
}

export function searchParamsIndicateExport(searchParams: URLSearchParams | null): boolean {
  if (!searchParams) return false
  const v = (key: string) => searchParams.get(key)?.toLowerCase() === "true"
  return v("print") || v("export") || v("pdf")
}

/**
 * Server-safe check using pathname and query string.
 * Use this in server components or when you only have pathname + search.
 */
export function getIsExportMode(pathname: string | null, searchParams: URLSearchParams | null): boolean {
  return pathnameIsExportRoute(pathname) || searchParamsIndicateExport(searchParams)
}
