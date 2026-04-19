import type { PlatformAnnouncementAudienceScope, WorkspaceSurface } from "@/lib/platform/announcementsTypes"

/**
 * Maps URL pathname to coarse workspace shell. "core" = legacy / shared routes
 * (e.g. /invoices) where audience may still be narrowed using business industry.
 */
export function workspaceSurfaceFromPathname(pathname: string | null | undefined): WorkspaceSurface {
  const p = pathname || ""
  if (p.startsWith("/accounting")) return "accounting"
  if (p.startsWith("/service")) return "service"
  if (p.startsWith("/retail")) return "retail"
  return "core"
}

export function announcementMatchesAudience(
  audience: PlatformAnnouncementAudienceScope,
  surface: WorkspaceSurface,
  businessIndustry: string | null | undefined
): boolean {
  const industry = (businessIndustry || "").toLowerCase()
  switch (audience) {
    case "all_tenants":
      return true
    case "service_workspace_only":
      return surface === "service" || (surface === "core" && industry === "service")
    case "retail_workspace_only":
      return surface === "retail" || (surface === "core" && industry === "retail")
    case "accounting_workspace_only":
      return surface === "accounting"
    default:
      return false
  }
}

export function isWorkspaceDashboardPath(pathname: string | null | undefined): boolean {
  const p = (pathname || "").replace(/\/$/, "") || "/"
  return /^\/(service|retail|accounting)\/dashboard$/.test(p)
}
