/**
 * Canonical client context guard for Accounting Workspace.
 * Firm users must have business_id (URL or session/cookie) on business-scoped routes.
 */

/** Path prefixes under /accounting that require a client business_id (firm users). */
const BUSINESS_SCOPED_PREFIXES = [
  "/accounting/ledger",
  "/accounting/reports",
  "/accounting/periods",
  "/accounting/reconciliation",
  "/accounting/afs",
  "/accounting/opening-balances",
  "/accounting/opening-balances-imports",
  "/accounting/drafts",
  "/accounting/journals",
  "/accounting/chart-of-accounts",
  "/accounting/carry-forward",
  "/accounting/adjustments",
  "/accounting/audit",
  "/accounting/health",
  "/accounting/trial-balance",
  "/accounting/exceptions",
]

/** Paths that are firm setup / client picker / control tower — no client required. */
const NO_CLIENT_PATHS = [
  "/accounting/firm",
  "/accounting/onboarding",
  "/accounting/control-tower",
]

export function isBusinessScopedPath(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/accounting"
  if (NO_CLIENT_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
    return false
  }
  return BUSINESS_SCOPED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))
}

/** Route where firm users pick a client and use "Enter Accounting". */
export const CLIENT_PICKER_PATH = "/firm/accounting-clients"

export function getClientPickerRedirect(returnTo: string): string {
  const separator = returnTo ? "?" : ""
  const query = returnTo ? `return_to=${encodeURIComponent(returnTo)}` : ""
  return `${CLIENT_PICKER_PATH}${separator}${query}`
}

export type RequireAccountingBusinessContextResult =
  | { ok: true; businessId: string }
  | { ok: false; redirectTo: string }
