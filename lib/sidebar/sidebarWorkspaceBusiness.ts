import type {
  WorkspaceBusiness,
  WorkspaceSessionUser,
} from "@/components/WorkspaceBusinessContext"

export function sidebarBusinessLabel(row: {
  trading_name?: string | null
  legal_name?: string | null
  name?: string | null
}): string | null {
  return row.trading_name?.trim() || row.legal_name?.trim() || row.name?.trim() || null
}

export function sidebarBrandingFromWorkspaceBusiness(
  business: WorkspaceBusiness
): { name: string | null; logo_url: string | null } | null {
  if (!business?.id) return null
  const row = business as {
    trading_name?: string | null
    legal_name?: string | null
    name?: string | null
    logo_url?: string | null
  }
  return {
    name: sidebarBusinessLabel(row),
    logo_url: row.logo_url ?? null,
  }
}

/** True only when owner_id on the business row matches the session user. */
export function isWorkspaceBusinessOwner(
  business: WorkspaceBusiness,
  sessionUser: WorkspaceSessionUser
): boolean {
  if (!business?.id || !sessionUser?.id) return false
  const ownerId = (business as { owner_id?: string | null }).owner_id
  return typeof ownerId === "string" && ownerId.length > 0 && ownerId === sessionUser.id
}

export function workspaceBusinessIndustry(
  business: WorkspaceBusiness
): string | null {
  if (!business) return null
  const industry = (business as { industry?: string | null }).industry
  return typeof industry === "string" ? industry : null
}
