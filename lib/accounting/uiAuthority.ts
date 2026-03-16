/**
 * Front-end authority helpers for engagement access level.
 * Use to disable actions and show tooltips; backend remains source of truth.
 */

export function canApproveEngagement(accessLevel?: string | null): boolean {
  return accessLevel === "approve"
}

export function canWriteEngagement(accessLevel?: string | null): boolean {
  return accessLevel === "write" || accessLevel === "approve"
}
