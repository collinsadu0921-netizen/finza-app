export type PracticeFirmRole = "partner" | "senior" | "junior" | "readonly"

export const CLIENT_NOT_ASSIGNED = "CLIENT_NOT_ASSIGNED"

export function isPracticeFirmRole(value: string | null | undefined): value is PracticeFirmRole {
  return value === "partner" || value === "senior" || value === "junior" || value === "readonly"
}

export function hasPortfolioWideVisibility(role: PracticeFirmRole): boolean {
  return role === "partner"
}

export function canManageClientAssignments(role: PracticeFirmRole): boolean {
  return role === "partner"
}

export function canManageAssignmentEnforcement(role: PracticeFirmRole): boolean {
  return role === "partner"
}

export function canBeTaskAssigneeWithoutClientAssignment(role: PracticeFirmRole): boolean {
  return role === "partner"
}

/**
 * Partner: all effective engagements.
 * Enforcement off (legacy): restricted roles also see all effective engagements.
 * Enforcement on: restricted roles see effective ∩ assigned.
 * Removing assignment rows does not turn enforcement off.
 */
export function resolveAuthorizedClientIds(opts: {
  role: PracticeFirmRole
  effectiveClientIds: Iterable<string>
  assignedClientIds: Iterable<string>
  assignmentEnforcementEnabled: boolean
}): string[] {
  const effective = [...new Set(opts.effectiveClientIds)]
  if (hasPortfolioWideVisibility(opts.role) || !opts.assignmentEnforcementEnabled) {
    return effective
  }
  const assigned = new Set(opts.assignedClientIds)
  return effective.filter((id) => assigned.has(id))
}

export function isClientInScope(opts: {
  role: PracticeFirmRole
  businessId: string
  assigned: boolean
  assignmentEnforcementEnabled: boolean
}): boolean {
  if (hasPortfolioWideVisibility(opts.role) || !opts.assignmentEnforcementEnabled) return true
  return opts.assigned
}

export function canAssignTaskToUser(opts: {
  assigneeRole: PracticeFirmRole | null
  assigneeAssignedToClient: boolean
  assignmentEnforcementEnabled: boolean
}): boolean {
  if (!opts.assigneeRole) return false
  if (canBeTaskAssigneeWithoutClientAssignment(opts.assigneeRole)) return true
  if (!opts.assignmentEnforcementEnabled) return true
  return opts.assigneeAssignedToClient
}
