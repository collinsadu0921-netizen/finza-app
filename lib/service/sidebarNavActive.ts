/**
 * Sidebar nav active-state matching for Service workspace routes.
 * Supports legacy shell URLs (/invoices, /bills, …) alongside /service/* canonical paths.
 */

function stripTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1)
  return path
}

/** Path only: no query string, normalized trailing slash. */
export function pathOnlyFromSidebarRoute(route: string): string {
  const raw = route.split("?")[0] ?? ""
  return stripTrailingSlash(raw || "")
}

export type SidebarNavSectionLike = {
  items: ReadonlyArray<{ route: string; skipActiveHighlight?: boolean }>
}

/**
 * When multiple nav items match (e.g. /service/settings vs /service/settings/staff),
 * only the longest matching path base should appear active.
 */
export function computeWinningSidebarNavPathBases(
  pathname: string | null | undefined,
  sections: ReadonlyArray<SidebarNavSectionLike>
): Set<string> {
  const bases: string[] = []
  for (const section of sections) {
    for (const item of section.items) {
      if (item.skipActiveHighlight) continue
      if (!isServiceSidebarNavItemActive(pathname, item.route)) continue
      bases.push(pathOnlyFromSidebarRoute(item.route))
    }
  }
  if (bases.length === 0) return new Set()
  const maxLen = Math.max(...bases.map((b) => b.length))
  return new Set(bases.filter((b) => b.length === maxLen))
}

function normalizeSidebarPathname(pathname: string | null | undefined): string {
  const raw = (pathname ?? "").split("?")[0] ?? ""
  return stripTrailingSlash(raw || "")
}

/**
 * Legacy service shell roots → canonical `/service/*` sidebar targets.
 * Order does not matter; each pair is independent.
 */
const LEGACY_SERVICE_NAV_ALIASES: ReadonlyArray<readonly [legacyRoot: string, canonicalBase: string]> = [
  ["/invoices", "/service/invoices"],
  ["/payments", "/service/payments"],
  ["/customers", "/service/customers"],
  ["/proforma", "/service/proforma"],
  ["/credit-notes", "/service/credit-notes"],
  ["/bills", "/service/bills"],
  ["/payroll", "/service/payroll"],
  ["/assets", "/service/assets"],
]

export function isServiceSidebarNavItemActive(
  pathname: string | null | undefined,
  itemRoute: string
): boolean {
  const p = normalizeSidebarPathname(pathname)
  const itemBase = pathOnlyFromSidebarRoute(itemRoute)

  if (itemBase === "/dashboard" || itemBase === "/retail/dashboard") {
    return p === "/dashboard" || p === "/retail/dashboard"
  }

  // Quotes nav uses /service/quotes (alias); estimates are the internal model for quotes.
  if (itemBase === "/service/quotes") {
    return (
      p === "/service/quotes" ||
      p === "/service/estimates" ||
      p.startsWith("/service/estimates/") ||
      p === "/estimates" ||
      p.startsWith("/estimates/") ||
      p === "/quotes" ||
      p.startsWith("/quotes/")
    )
  }

  for (const [legacyRoot, canonical] of LEGACY_SERVICE_NAV_ALIASES) {
    if (itemBase !== canonical) continue
    if (p === legacyRoot || p.startsWith(`${legacyRoot}/`)) return true
  }

  return p === itemBase || (itemBase !== "/" && p.startsWith(`${itemBase}/`))
}
