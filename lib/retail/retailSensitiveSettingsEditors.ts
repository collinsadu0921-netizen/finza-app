/**
 * Who may change business-wide settings used by retail (and shared APIs).
 * Managers/cashiers must not mutate these via API.
 */
export function canEditBusinessWideSensitiveSettings(role: string | null): boolean {
  return role === "owner" || role === "admin"
}
