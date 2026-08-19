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

export function canBeTaskAssigneeWithoutClientAssignment(role: PracticeFirmRole): boolean {
  return role === "partner"
}

/**
 * Compatibility: a firm with zero assignment rows keeps pre-P1B firm-wide
 * visibility so existing staff are not locked out. The first assignment row
 * turns enforcement on for restricted roles.
 */
export function resolveAuthorizedClientIds(opts: {
  role: PracticeFirmRole
  effectiveClientIds: Iterable<string>
  assignedClientIds: Iterable<string>
  firmHasAssignmentRows: boolean
}): string[] {
  const effective = [...new Set(opts.effectiveClientIds)]
  if (hasPortfolioWideVisibility(opts.role) || !opts.firmHasAssignmentRows) {
    return effective
  }
  const assigned = new Set(opts.assignedClientIds)
  return effective.filter((id) => assigned.has(id))
}

export function isClientInScope(opts: {
  role: PracticeFirmRole
  businessId: string
  assigned: boolean
  firmHasAssignmentRows: boolean
}): boolean {
  if (hasPortfolioWideVisibility(opts.role) || !opts.firmHasAssignmentRows) return true
  return opts.assigned
}

export function canAssignTaskToUser(opts: {
  assigneeRole: PracticeFirmRole | null
  assigneeAssignedToClient: boolean
  firmHasAssignmentRows: boolean
}): boolean {
  if (!opts.assigneeRole) return false
  if (canBeTaskAssigneeWithoutClientAssignment(opts.assigneeRole)) return true
  if (!opts.firmHasAssignmentRows) return true
  return opts.assigneeAssignedToClient
}
