/**
 * Staff create/remove rules for POST /api/staff/create-system-user and remove-business-user.
 * Applies to any business industry using these endpoints.
 */

export function canActorCreateStaffRole(actorRole: string | null, targetRole: string): boolean {
  if (!actorRole || actorRole === "cashier") return false
  if (actorRole === "manager") return targetRole === "cashier"
  if (actorRole === "admin") return targetRole === "manager" || targetRole === "cashier"
  if (actorRole === "owner") return targetRole === "admin" || targetRole === "manager" || targetRole === "cashier"
  return false
}

/**
 * Whether the signed-in actor may remove the target membership.
 * @param businessOwnerId businesses.owner_id — cannot remove the owner user from the business
 */
export function canActorRemoveBusinessMember(
  actorRole: string | null,
  actorUserId: string,
  targetUserId: string,
  targetRole: string,
  businessOwnerId: string | null
): boolean {
  if (!actorRole || actorRole === "cashier") return false

  if (businessOwnerId && targetUserId === businessOwnerId) return false

  if (targetUserId === actorUserId) return false

  if (targetRole === "owner") return false

  if (actorRole === "manager") {
    return targetRole === "cashier"
  }

  if (actorRole === "admin") {
    if (targetRole === "admin") return false
    return targetRole === "manager" || targetRole === "cashier"
  }

  if (actorRole === "owner") {
    return targetRole === "admin" || targetRole === "manager" || targetRole === "cashier"
  }

  return false
}
