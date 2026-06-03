import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime"

/** Normalize pathname + search for stable equality checks. */
export function normalizeAppHref(pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  const normalized = new URLSearchParams()
  for (const [key, value] of entries) {
    normalized.set(key, value)
  }
  const qs = normalized.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/** True when router/history should update the URL. */
export function appHrefNeedsUpdate(
  currentPathname: string,
  currentSearch: string,
  targetHref: string
): boolean {
  const currentHref = normalizeAppHref(currentPathname, currentSearch)
  const [targetPath, targetSearch = ""] = targetHref.split("?")
  const normalizedTarget = normalizeAppHref(targetPath, targetSearch)
  return currentHref !== normalizedTarget
}

/**
 * Call `router.replace` only when the target URL differs from the current location.
 * @returns true when a navigation was requested
 */
export function replaceIfChanged(
  router: AppRouterInstance,
  currentPathname: string,
  currentSearch: string,
  targetHref: string,
  options?: { scroll?: boolean }
): boolean {
  if (!appHrefNeedsUpdate(currentPathname, currentSearch, targetHref)) {
    return false
  }
  router.replace(targetHref, { scroll: options?.scroll ?? false })
  return true
}
