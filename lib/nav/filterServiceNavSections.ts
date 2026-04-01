import { hasPermission, type CustomPermissions } from "@/lib/permissions"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import { getRequiredPermissionForPath, normalizePathForPermission } from "./routePermissionRules"

export type ServiceNavMenuItem = {
  label: string
  route: string
  minTier?: ServiceSubscriptionTier
}

export type ServiceNavSection = { title: string; items: ServiceNavMenuItem[] }

/**
 * Drops items the role cannot access (via ROUTE_PERMISSION_RULES) and removes empty sections.
 */
export function filterServiceNavSections(
  sections: ServiceNavSection[],
  options: {
    role: string
    customPermissions: CustomPermissions | null
  }
): ServiceNavSection[] {
  const { role, customPermissions } = options
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        const perm = getRequiredPermissionForPath(normalizePathForPermission(item.route))
        if (perm === null) return true
        return hasPermission(role, customPermissions, perm)
      }),
    }))
    .filter((s) => s.items.length > 0)
}
