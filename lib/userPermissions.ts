/**
 * User permissions resolver.
 *
 * Computes a user's effective permissions for a business by combining:
 *   1. Role defaults  (ROLE_DEFAULTS[role])
 *   2. Custom grants  (business_users.custom_permissions.granted)
 *   3. Custom revokes (business_users.custom_permissions.revoked)
 *
 * Effective permissions = role_defaults + granted − revoked
 *
 * "owner" always receives all permissions and ignores custom_permissions.
 *
 * Usage in an API route:
 *   const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_APPROVE)
 *   if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getUserRole } from "@/lib/userRoles"
import { ALL_PERMISSIONS, ROLE_DEFAULTS, type Permission } from "@/lib/permissions"

interface CustomPermissions {
  granted: Permission[]
  revoked: Permission[]
}

interface PermissionCheckResult {
  allowed: boolean
  role: string | null
  effectivePermissions?: Set<Permission>
}

/**
 * Fetch the custom_permissions JSON field from business_users for a given user+business.
 * Returns empty granted/revoked arrays if not found or not set.
 */
async function getCustomPermissions(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<CustomPermissions> {
  const { data } = await supabase
    .from("business_users")
    .select("custom_permissions")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle()

  const raw = data?.custom_permissions as Partial<CustomPermissions> | null
  return {
    granted: Array.isArray(raw?.granted) ? (raw!.granted as Permission[]) : [],
    revoked: Array.isArray(raw?.revoked) ? (raw!.revoked as Permission[]) : [],
  }
}

/**
 * Compute the full set of effective permissions for a user in a business.
 *
 * @returns Set<Permission> — the permissions the user actually has
 */
export async function getEffectivePermissions(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<Set<Permission>> {
  const role = await getUserRole(supabase, userId, businessId)

  // Owner always has everything
  if (role === "owner") {
    return new Set(ALL_PERMISSIONS)
  }

  if (!role) return new Set()

  // Start with role defaults
  const defaults = ROLE_DEFAULTS[role] ?? []
  const effective = new Set<Permission>(defaults)

  // Apply custom overrides
  const custom = await getCustomPermissions(supabase, userId, businessId)
  for (const p of custom.granted) effective.add(p)
  for (const p of custom.revoked) effective.delete(p)

  return effective
}

/**
 * Check if a user has a specific permission.
 *
 * @returns true if the user has the permission, false otherwise
 */
export async function hasPermission(
  supabase: SupabaseClient,
  userId: string,
  businessId: string,
  permission: Permission
): Promise<boolean> {
  const effective = await getEffectivePermissions(supabase, userId, businessId)
  return effective.has(permission)
}

/**
 * Guard helper for API routes.
 * Returns { allowed: true, role } if the user has the permission,
 * or { allowed: false, role } if not.
 *
 * Example:
 *   const { allowed, role } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_APPROVE)
 *   if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
 */
export async function requirePermission(
  supabase: SupabaseClient,
  userId: string,
  businessId: string,
  permission: Permission
): Promise<PermissionCheckResult> {
  const role = await getUserRole(supabase, userId, businessId)

  // No role = not a member
  if (!role) return { allowed: false, role: null }

  // Owner always allowed
  if (role === "owner") return { allowed: true, role }

  const effective = await getEffectivePermissions(supabase, userId, businessId)
  return { allowed: effective.has(permission), role }
}

/**
 * Update the custom_permissions for a team member.
 * Only call this from the admin-only permissions management API.
 *
 * @param granted  Permissions to add on top of the role defaults
 * @param revoked  Permissions to remove from the role defaults
 */
export async function setCustomPermissions(
  supabase: SupabaseClient,
  userId: string,
  businessId: string,
  granted: Permission[],
  revoked: Permission[]
): Promise<void> {
  const { error } = await supabase
    .from("business_users")
    .update({ custom_permissions: { granted, revoked } })
    .eq("business_id", businessId)
    .eq("user_id", userId)

  if (error) throw error
}
