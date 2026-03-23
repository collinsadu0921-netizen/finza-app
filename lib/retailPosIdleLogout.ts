/**
 * Shared-device safety for retail POS: optional idle auto-logout.
 *
 * Cashiers use sessionStorage (clears when the tab/window is closed); managers
 * who sign in with email use persistent Supabase cookies, so closing the tab
 * does not end the session. For POS kiosks, set:
 *   NEXT_PUBLIC_RETAIL_POS_IDLE_LOGOUT_MINUTES=15
 * in .env so inactivity signs out and clears the cashier PIN session.
 */

export function getRetailPosIdleLogoutMs(): number {
  const raw = process.env.NEXT_PUBLIC_RETAIL_POS_IDLE_LOGOUT_MINUTES
  if (raw === undefined || raw === "") return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(Math.floor(n * 60 * 1000), 24 * 60 * 60 * 1000) // cap 24h
}

export function isRetailPosIdleWatchPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  const p = pathname.split("?")[0]
  if (p.endsWith("/") && p !== "/") return isRetailPosIdleWatchPath(p.slice(0, -1))
  if (p === "/retail/pos/pin") return false
  return p === "/pos" || p.startsWith("/pos/") || p === "/retail/pos" || p.startsWith("/retail/pos/")
}
