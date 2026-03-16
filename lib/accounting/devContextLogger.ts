/**
 * Wave 6/7: Development-only logger for accounting context.
 * Logs warnings when accounting routes or APIs are used without business_id.
 * No runtime behavior change; console only.
 */

const DEV = process.env.NODE_ENV === "development"

export function logAccountingRouteWithoutBusinessId(pathname: string): void {
  if (!DEV) return
  console.warn(
    "[accounting] Route loaded without business_id:",
    pathname,
    "— use ?business_id= for client-scoped pages."
  )
}

/** Wave 7: Log when accountant loads portal or legacy reports without business_id. */
export function logAccountantPortalOrReportsWithoutBusinessId(
  pathname: string,
  context: "portal" | "legacy_report"
): void {
  if (!DEV) return
  console.warn(
    "[accounting] Accountant loaded",
    context === "portal" ? "portal" : "legacy report",
    "without business_id:",
    pathname,
    "— use ?business_id= or Control Tower."
  )
}

export function logAccountingApiWithoutBusinessId(
  method: string,
  path: string,
  source?: string
): void {
  if (!DEV) return
  console.warn(
    "[accounting] API called without business_id:",
    method,
    path,
    source ? `(${source})` : ""
  )
}

/** Legacy accounting path prefixes (Wave 12). */
const LEGACY_ACCOUNTING_PREFIXES = [
  "/ledger",
  "/trial-balance",
  "/reconciliation",
  "/accounts",
  "/service/ledger",
  "/service/accounting",
  "/service/reports",
]

/**
 * Wave 12: Log when a legacy accounting route is used (not inside canonical /accounting/*).
 * Trigger from layout or client when pathname matches legacy pattern.
 */
export function logLegacyAccountingRouteUsage(pathname: string): void {
  if (!DEV) return
  if (!pathname || pathname.startsWith("/accounting")) return
  const path = pathname.replace(/\/$/, "") || "/"
  const isLegacy = LEGACY_ACCOUNTING_PREFIXES.some(
    (p) => path === p || path.startsWith(p + "/")
  )
  if (isLegacy) {
    console.warn(
      "[accounting] Legacy accounting route — navigate to /accounting/* instead:",
      pathname
    )
  }
}

/** Wave 13: Log when context resolver is used (for dev audit). */
export type AccountingContextResolverSource = "workspace" | "api" | "portal" | "reports"

export function logAccountingContextResolverUsage(source: AccountingContextResolverSource): void {
  if (!DEV) return
  console.warn("[accounting] Context resolver used without business_id:", source)
}
