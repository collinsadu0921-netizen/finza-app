/**
 * P0 Practice → Service client-books boundary.
 *
 * Firm practitioners may open only these Service surfaces for an engaged client.
 * Everything else under /service/* remains owner/employee Service access.
 */

export const PRACTICE_CLIENT_BOOKS_PATHS = [
  "/service/reports/profit-and-loss",
  "/service/reports/balance-sheet",
  "/service/reports/trial-balance",
  "/service/ledger",
] as const

export type PracticeClientBooksPath = (typeof PRACTICE_CLIENT_BOOKS_PATHS)[number]

export function normalizePracticePath(pathname: string): string {
  const path = (pathname || "").split("?")[0]
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path
}

export function isPracticeClientBooksPath(pathname: string): boolean {
  const normalized = normalizePracticePath(pathname)
  return PRACTICE_CLIENT_BOOKS_PATHS.some((route) => normalized === route)
}

export function buildPracticeOpenBooksHref(businessId: string): string {
  const id = businessId.trim()
  return `/service/reports/profit-and-loss?business_id=${encodeURIComponent(id)}`
}

export function buildPracticeClientOverviewHref(businessId: string): string {
  return `/accounting/clients/${encodeURIComponent(businessId.trim())}/overview`
}

export const PRACTICE_SENSITIVE_SERVICE_PREFIXES = [
  "/service/payroll",
  "/service/settings/staff",
  "/service/settings/team",
  "/service/settings/subscription",
  "/service/settings",
  "/payroll",
] as const

export function isPracticeBlockedServicePath(pathname: string): boolean {
  const normalized = normalizePracticePath(pathname)
  if (isPracticeClientBooksPath(normalized)) return false
  return PRACTICE_SENSITIVE_SERVICE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  )
}
