/**
 * Discount Validation (Phase 1 - Advanced Discounts)
 * 
 * Enforces discount caps and role-based limits.
 * Used in both UI and API to prevent unauthorized discounts.
 */

import type { LineDiscount, CartDiscount } from "./calculator"
import { getAuthorityLevel, type UserRole } from "@/lib/authority"

export type DiscountCaps = {
  max_discount_percent?: number | null
  max_discount_amount?: number | null
  max_discount_per_sale_percent?: number | null
  max_discount_per_sale_amount?: number | null
  max_discount_per_line_percent?: number | null
  max_discount_per_line_amount?: number | null
}

export type RoleDiscountLimit = {
  max_percent?: number | null
  max_amount?: number | null
}

export type DiscountValidationResult = {
  valid: boolean
  error?: string
  exceeded_cap?: {
    type: 'global_percent' | 'global_amount' | 'sale_percent' | 'sale_amount' | 'line_percent' | 'line_amount' | 'role_percent' | 'role_amount'
    limit: number
    actual: number
  }
}

/**
 * Get role-based discount limit
 */
export function getRoleDiscountLimit(
  roleLimits: Record<string, RoleDiscountLimit> | null | undefined,
  userRole: UserRole
): RoleDiscountLimit | null {
  if (!roleLimits || !userRole) {
    return null
  }

  return roleLimits[userRole] || null
}

/**
 * Validate line discount against caps and role limits
 */
export function validateLineDiscount(
  discount: LineDiscount,
  lineTotal: number,
  caps: DiscountCaps,
  roleLimit: RoleDiscountLimit | null,
  userRole: UserRole
): DiscountValidationResult {
  if (discount.discount_type === 'none' || discount.discount_value <= 0) {
    return { valid: true }
  }

  // Calculate discount amount
  let discountAmount = 0
  let discountPercent = 0

  if (discount.discount_type === 'percent') {
    discountPercent = Math.min(100, Math.max(0, discount.discount_value))
    discountAmount = (lineTotal * discountPercent) / 100
  } else if (discount.discount_type === 'amount') {
    discountAmount = Math.min(discount.discount_value, lineTotal)
    discountPercent = lineTotal > 0 ? (discountAmount / lineTotal) * 100 : 0
  }

  // Check role-based limit
  if (roleLimit) {
    if (roleLimit.max_percent !== null && roleLimit.max_percent !== undefined) {
      if (discountPercent > roleLimit.max_percent) {
        return {
          valid: false,
          error: `Discount exceeds your role limit of ${roleLimit.max_percent}%`,
          exceeded_cap: {
            type: 'role_percent',
            limit: roleLimit.max_percent,
            actual: discountPercent,
          },
        }
      }
    }

    if (roleLimit.max_amount !== null && roleLimit.max_amount !== undefined) {
      if (discountAmount > roleLimit.max_amount) {
        return {
          valid: false,
          error: `Discount exceeds your role limit of ${roleLimit.max_amount}`,
          exceeded_cap: {
            type: 'role_amount',
            limit: roleLimit.max_amount,
            actual: discountAmount,
          },
        }
      }
    }
  }

  // Check per-line caps
  if (caps.max_discount_per_line_percent !== null && caps.max_discount_per_line_percent !== undefined) {
    if (discountPercent > caps.max_discount_per_line_percent) {
      return {
        valid: false,
        error: `Line discount exceeds maximum of ${caps.max_discount_per_line_percent}%`,
        exceeded_cap: {
          type: 'line_percent',
          limit: caps.max_discount_per_line_percent,
          actual: discountPercent,
        },
      }
    }
  }

  if (caps.max_discount_per_line_amount !== null && caps.max_discount_per_line_amount !== undefined) {
    if (discountAmount > caps.max_discount_per_line_amount) {
      return {
        valid: false,
        error: `Line discount exceeds maximum of ${caps.max_discount_per_line_amount}`,
        exceeded_cap: {
          type: 'line_amount',
          limit: caps.max_discount_per_line_amount,
          actual: discountAmount,
        },
      }
    }
  }

  return { valid: true }
}

/**
 * Validate cart discount against caps and role limits
 */
export function validateCartDiscount(
  discount: CartDiscount,
  cartSubtotal: number,
  caps: DiscountCaps,
  roleLimit: RoleDiscountLimit | null,
  userRole: UserRole
): DiscountValidationResult {
  if (discount.discount_type === 'none' || discount.discount_value <= 0) {
    return { valid: true }
  }

  // Calculate discount amount
  let discountAmount = 0
  let discountPercent = 0

  if (discount.discount_type === 'percent') {
    discountPercent = Math.min(100, Math.max(0, discount.discount_value))
    discountAmount = (cartSubtotal * discountPercent) / 100
  } else if (discount.discount_type === 'amount') {
    discountAmount = Math.min(discount.discount_value, cartSubtotal)
    discountPercent = cartSubtotal > 0 ? (discountAmount / cartSubtotal) * 100 : 0
  }

  // Check role-based limit
  if (roleLimit) {
    if (roleLimit.max_percent !== null && roleLimit.max_percent !== undefined) {
      if (discountPercent > roleLimit.max_percent) {
        return {
          valid: false,
          error: `Cart discount exceeds your role limit of ${roleLimit.max_percent}%`,
          exceeded_cap: {
            type: 'role_percent',
            limit: roleLimit.max_percent,
            actual: discountPercent,
          },
        }
      }
    }

    if (roleLimit.max_amount !== null && roleLimit.max_amount !== undefined) {
      if (discountAmount > roleLimit.max_amount) {
        return {
          valid: false,
          error: `Cart discount exceeds your role limit of ${roleLimit.max_amount}`,
          exceeded_cap: {
            type: 'role_amount',
            limit: roleLimit.max_amount,
            actual: discountAmount,
          },
        }
      }
    }
  }

  // Check per-sale caps
  if (caps.max_discount_per_sale_percent !== null && caps.max_discount_per_sale_percent !== undefined) {
    if (discountPercent > caps.max_discount_per_sale_percent) {
      return {
        valid: false,
        error: `Cart discount exceeds maximum of ${caps.max_discount_per_sale_percent}%`,
        exceeded_cap: {
          type: 'sale_percent',
          limit: caps.max_discount_per_sale_percent,
          actual: discountPercent,
        },
      }
    }
  }

  if (caps.max_discount_per_sale_amount !== null && caps.max_discount_per_sale_amount !== undefined) {
    if (discountAmount > caps.max_discount_per_sale_amount) {
      return {
        valid: false,
        error: `Cart discount exceeds maximum of ${caps.max_discount_per_sale_amount}`,
        exceeded_cap: {
          type: 'sale_amount',
          limit: caps.max_discount_per_sale_amount,
          actual: discountAmount,
        },
      }
    }
  }

  return { valid: true }
}

/**
 * Validate total discount (line + cart) against global caps
 */
export function validateTotalDiscount(
  totalDiscountAmount: number,
  totalDiscountPercent: number,
  cartSubtotalBeforeDiscount: number,
  caps: DiscountCaps
): DiscountValidationResult {
  // Check global caps
  if (caps.max_discount_percent !== null && caps.max_discount_percent !== undefined) {
    if (totalDiscountPercent > caps.max_discount_percent) {
      return {
        valid: false,
        error: `Total discount exceeds global maximum of ${caps.max_discount_percent}%`,
        exceeded_cap: {
          type: 'global_percent',
          limit: caps.max_discount_percent,
          actual: totalDiscountPercent,
        },
      }
    }
  }

  if (caps.max_discount_amount !== null && caps.max_discount_amount !== undefined) {
    if (totalDiscountAmount > caps.max_discount_amount) {
      return {
        valid: false,
        error: `Total discount exceeds global maximum of ${caps.max_discount_amount}`,
        exceeded_cap: {
          type: 'global_amount',
          limit: caps.max_discount_amount,
          actual: totalDiscountAmount,
        },
      }
    }
  }

  return { valid: true }
}

/**
 * Get maximum allowed discount for a role
 * Returns the most restrictive limit (role limit or global cap)
 */
export function getMaxAllowedDiscount(
  caps: DiscountCaps,
  roleLimit: RoleDiscountLimit | null,
  isLineDiscount: boolean = false
): { max_percent: number | null; max_amount: number | null } {
  let max_percent: number | null = null
  let max_amount: number | null = null

  // Start with global caps
  if (isLineDiscount) {
    max_percent = caps.max_discount_per_line_percent ?? caps.max_discount_percent ?? null
    max_amount = caps.max_discount_per_line_amount ?? caps.max_discount_amount ?? null
  } else {
    max_percent = caps.max_discount_per_sale_percent ?? caps.max_discount_percent ?? null
    max_amount = caps.max_discount_per_sale_amount ?? caps.max_discount_amount ?? null
  }

  // Apply role limit if more restrictive
  if (roleLimit) {
    if (roleLimit.max_percent !== null && roleLimit.max_percent !== undefined) {
      if (max_percent === null || roleLimit.max_percent < max_percent) {
        max_percent = roleLimit.max_percent
      }
    }

    if (roleLimit.max_amount !== null && roleLimit.max_amount !== undefined) {
      if (max_amount === null || roleLimit.max_amount < max_amount) {
        max_amount = roleLimit.max_amount
      }
    }
  }

  return { max_percent, max_amount }
}
