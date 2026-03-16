/**
 * Authority-Based Access Control
 * Maps user roles to authority levels for override logic
 * 
 * Authority Model:
 * - Cashier = 10
 * - Supervisor/Manager = 50
 * - Admin = 100
 */

export type UserRole = "cashier" | "manager" | "admin" | "owner" | "employee" | "accountant" | null

/**
 * Get authority level for a user role
 * @param role - User role from business_users table or "owner" from businesses.owner_id
 * @returns Authority level (10 = cashier, 50 = manager, 100 = admin/owner)
 */
export function getAuthorityLevel(role: UserRole): number {
  switch (role) {
    case "cashier":
    case "employee":
      return 10 // Cashier authority
    case "manager":
      return 50 // Supervisor/Manager authority
    case "admin":
    case "owner":
      return 100 // Admin authority (highest)
    case "accountant":
      // Accountants have read-only access, no override authority
      return 0
    default:
      return 0 // Unknown role = no authority
  }
}

/**
 * Check if user has sufficient authority for an action
 * @param userAuthority - Authority level of the user attempting the action
 * @param requiredAuthority - Minimum authority level required
 * @returns true if user has sufficient authority
 */
export function hasAuthority(userAuthority: number, requiredAuthority: number): boolean {
  return userAuthority >= requiredAuthority
}

/**
 * Check if override is required based on authority levels
 * Override is required if user's authority is less than the required authority
 * @param userAuthority - Authority level of the user attempting the action
 * @param requiredAuthority - Minimum authority level required for the action
 * @returns true if override prompt should be shown
 */
export function requiresOverride(userAuthority: number, requiredAuthority: number): boolean {
  return userAuthority < requiredAuthority
}

/**
 * Authority levels for different actions
 */
export const AUTHORITY_LEVELS = {
  CASHIER: 10,
  MANAGER: 50,
  ADMIN: 100,
} as const

/**
 * Required authority for different actions
 */
export const REQUIRED_AUTHORITY = {
  REFUND: AUTHORITY_LEVELS.MANAGER, // 50 - Manager or Admin can refund
  VOID: AUTHORITY_LEVELS.MANAGER, // 50 - Manager or Admin can void
  DISCOUNT_OVERRIDE: AUTHORITY_LEVELS.MANAGER, // 50 - Manager or Admin can approve discounts > 10%
  REGISTER_VARIANCE: AUTHORITY_LEVELS.MANAGER, // 50 - Manager or Admin can approve register variances
} as const




