/**
 * Check if a discount percentage requires supervisor override
 * @param discountPercent - The discount percentage to check
 * @returns true if discount > 10%, false otherwise
 */
export function requiresDiscountOverride(discountPercent: number): boolean {
  return discountPercent > 10
}

/**
 * Validate discount percentage
 * @param discountPercent - The discount percentage to validate
 * @returns true if valid (0-100), false otherwise
 */
export function isValidDiscountPercent(discountPercent: number): boolean {
  return discountPercent >= 0 && discountPercent <= 100
}

/**
 * Calculate discounted amount
 * @param originalAmount - Original amount before discount
 * @param discountPercent - Discount percentage (0-100)
 * @returns Discounted amount
 */
export function calculateDiscountedAmount(
  originalAmount: number,
  discountPercent: number
): number {
  if (!isValidDiscountPercent(discountPercent)) {
    throw new Error("Invalid discount percentage")
  }
  return originalAmount * (1 - discountPercent / 100)
}



