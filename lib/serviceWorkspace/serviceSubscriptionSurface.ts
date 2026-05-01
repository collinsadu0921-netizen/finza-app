/**
 * Where the Service subscription entitlement React context must stay mounted.
 *
 * Keeps `useServiceSubscription()` aligned with the DB for legacy routes that
 * live outside `/service/*` (e.g. `/reports/vat`, `/vat-returns`) so sidebar
 * tier locks do not flicker or disappear after navigation.
 */

function stripQuery(pathname: string): string {
  return pathname.split("?")[0] || ""
}

/** Path prefixes used by the legacy service shell (non-`/service` URLs). */
export function isLegacyServiceShellPath(pathname: string | null | undefined): boolean {
  const p = stripQuery(pathname ?? "")
  if (!p) return false
  const prefixes = [
    "/service",
    "/reports",
    "/vat-returns",
    "/bills",
    "/payroll",
    "/assets",
    "/credit-notes",
    "/audit-log",
    "/invoices",
    "/estimates",
    "/payments",
    "/customers",
    "/projects",
    "/proforma",
  ] as const
  return prefixes.some((pre) => p === pre || p.startsWith(`${pre}/`))
}

/**
 * Mount `ServiceSubscriptionProvider` when the URL is a service workspace
 * surface. Pathname-only (no sessionStorage) so server and client agree for SSR.
 * Excludes retail and firm accounting shells.
 */
export function shouldMountServiceSubscriptionProvider(
  pathname: string | null | undefined
): boolean {
  const p = stripQuery(pathname ?? "")
  if (p.startsWith("/retail")) return false
  if (p.startsWith("/accounting")) return false
  return isLegacyServiceShellPath(p)
}
