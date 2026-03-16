/**
 * Wave 6: Hard route assertion for accountant workspace.
 * Client-scoped accounting routes MUST have business_id (URL). Control Tower exempt.
 */

export const CLIENT_REQUIRED = "CLIENT_REQUIRED" as const

/** Path prefixes under /accounting that require URL business_id (client-scoped). */
const CLIENT_SCOPED_PREFIXES = [
  "/accounting/ledger",
  "/accounting/periods",
  "/accounting/chart-of-accounts",
  "/accounting/reconciliation",
  "/accounting/opening-balances",
  "/accounting/opening-balances-imports",
  "/accounting/journals",
  "/accounting/drafts",
  "/accounting/reports",
  "/accounting/trial-balance",
]

/** Paths that are firm / control tower — no client required. */
const EXEMPT_PREFIXES = [
  "/accounting/firm",
  "/accounting/control-tower",
  "/accounting/onboarding",
]

function isClientScopedPath(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/accounting"
  if (EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) {
    return false
  }
  return CLIENT_SCOPED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))
}

/**
 * Asserts that a client-scoped accounting route has business_id.
 * If pathname is under /accounting and client-scoped and businessId is missing, returns CLIENT_REQUIRED.
 * Control Tower and firm routes are exempt.
 */
export function assertAccountingRouteContext(
  pathname: string,
  businessId?: string | null
): void {
  if (!pathname.startsWith("/accounting")) return
  if (!isClientScopedPath(pathname)) return
  if (businessId != null && String(businessId).trim() !== "") return
  throw new Error(CLIENT_REQUIRED)
}

/**
 * Safe check: returns true if route context is satisfied (exempt or has businessId).
 * Use when you prefer EmptyState over throw.
 */
export function hasAccountingRouteContext(
  pathname: string,
  businessId?: string | null
): boolean {
  if (!pathname.startsWith("/accounting")) return true
  if (!isClientScopedPath(pathname)) return true
  return businessId != null && String(businessId).trim() !== ""
}

/** Legacy accounting path patterns (Wave 12: must redirect or 404). */
const LEGACY_ACCOUNTING_PATTERNS = [
  "/ledger",
  "/trial-balance",
  "/reconciliation",
  "/accounts",
  "/service/ledger",
  "/service/accounting",
  "/service/reports",
]

function touchesLegacyAccountingDomain(pathname: string): boolean {
  const path = (pathname ?? "").replace(/\/$/, "") || "/"
  if (path.startsWith("/accounting")) return false
  return LEGACY_ACCOUNTING_PATTERNS.some(
    (p) => path === p || path.startsWith(p + "/")
  )
}

/**
 * Wave 12: Log dev warning if route touches accounting domain but is not canonical.
 * Call from layout or middleware when pathname is known.
 */
export function assertCanonicalAccountingEntry(pathname: string): void {
  if (typeof process === "undefined" || process.env.NODE_ENV !== "development") return
  if (!pathname || pathname.startsWith("/accounting")) return
  if (touchesLegacyAccountingDomain(pathname)) {
    console.warn(
      "[accounting] Legacy accounting route used — use canonical /accounting/*:",
      pathname
    )
  }
}
