/**
 * Mirrors migration 580 membership write rules for unit tests.
 * The database trigger and RLS policies are the enforcement.
 */

export type MembershipActorRole = "owner" | "admin" | "manager" | "cashier" | "accountant" | "staff" | null

export function canSelfInsertAdminMembership(input: {
  actorUserId: string
  rowUserId: string
  role: string
  ownsBusiness: boolean
}): boolean {
  return input.ownsBusiness && input.actorUserId === input.rowUserId && input.role === "admin"
}

export function canChangeOtherMembership(input: {
  actorRole: MembershipActorRole
  actorUserId: string
  targetUserId: string
  previousRole: string
  nextRole: string
}): boolean {
  if (!input.actorRole) return false
  if (input.actorUserId === input.targetUserId) return false
  if (input.actorRole === "cashier" || input.actorRole === "staff" || input.actorRole === "accountant") {
    return false
  }
  if (input.actorRole === "owner") {
    return ["admin", "manager", "cashier", "accountant", "staff"].includes(input.nextRole)
  }
  if (input.actorRole === "admin") {
    return (
      ["manager", "cashier"].includes(input.previousRole) &&
      ["manager", "cashier"].includes(input.nextRole)
    )
  }
  if (input.actorRole === "manager") {
    return input.previousRole === "cashier" && input.nextRole === "cashier"
  }
  return false
}

export function canDeleteMembership(input: {
  actorRole: MembershipActorRole
  actorUserId: string
  targetUserId: string
  targetRole: string
  businessOwnerId: string
}): boolean {
  if (input.actorUserId === input.targetUserId) return false
  if (input.targetUserId === input.businessOwnerId) return false
  if (input.targetRole === "owner") return false
  if (input.actorRole === "owner") {
    return ["admin", "manager", "cashier", "accountant", "staff"].includes(input.targetRole)
  }
  if (input.actorRole === "admin") return input.targetRole === "manager" || input.targetRole === "cashier"
  if (input.actorRole === "manager") return input.targetRole === "cashier"
  return false
}
