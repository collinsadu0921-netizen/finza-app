/**
 * Path helpers for ProtectedLayout orchestration (not access decisions).
 */

/** True for `/service/*` workspace routes — store auto-bind is retail-only. */
export function isServiceWorkspacePath(pathname: string | null | undefined): boolean {
  const path = (pathname || "").split("?")[0]
  const normalized = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path
  return normalized === "/service" || normalized.startsWith("/service/")
}
