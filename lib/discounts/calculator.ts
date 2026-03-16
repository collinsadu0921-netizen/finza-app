/**
 * Discount Calculator (Phase 1 - Ledger-Safe Pricing)
 * 
 * Computes discounts BEFORE posting to ledger.
 * All calculations are deterministic and immutable after sale creation.
 */

export type LineDiscount = {
  discount_type: 'none' | 'percent' | 'amount'
  discount_value: number
}

export type CartDiscount = {
  discount_type: 'none' | 'percent' | 'amount'
  discount_value: number
}

export type LineItem = {
  quantity: number
  unit_price: number
  discount?: LineDiscount
}

export type DiscountCalculationResult = {
  // Line item results
  lineItems: Array<{
    gross_line_before: number
    line_discount_amount: number
    net_line: number
  }>
  // Cart totals
  subtotal_before_discount: number
  total_line_discount: number
  subtotal_after_line_discounts: number
  cart_discount_amount: number
  total_discount: number
  subtotal_after_discount: number
}

/**
 * Calculate line item discount amount
 */
function calculateLineDiscount(
  quantity: number,
  unitPrice: number,
  discount: LineDiscount
): number {
  if (discount.discount_type === 'none' || discount.discount_value <= 0) {
    return 0
  }

  const grossLine = quantity * unitPrice

  if (discount.discount_type === 'percent') {
    const percent = Math.min(100, Math.max(0, discount.discount_value))
    return (grossLine * percent) / 100
  } else if (discount.discount_type === 'amount') {
    const amount = Math.max(0, discount.discount_value)
    return Math.min(amount, grossLine) // Prevent discount > line total
  }

  return 0
}

/**
 * Calculate cart discount amount
 * Applied proportionally across net lines for tax correctness
 */
function calculateCartDiscount(
  subtotalAfterLineDiscounts: number,
  discount: CartDiscount
): number {
  if (discount.discount_type === 'none' || discount.discount_value <= 0) {
    return 0
  }

  if (subtotalAfterLineDiscounts <= 0) {
    return 0
  }

  if (discount.discount_type === 'percent') {
    const percent = Math.min(100, Math.max(0, discount.discount_value))
    return (subtotalAfterLineDiscounts * percent) / 100
  } else if (discount.discount_type === 'amount') {
    const amount = Math.max(0, discount.discount_value)
    return Math.min(amount, subtotalAfterLineDiscounts) // Prevent discount > subtotal
  }

  return 0
}

/**
 * Main discount calculation function
 * Computes all discounts and net amounts BEFORE tax calculation
 */
export function calculateDiscounts(
  lineItems: LineItem[],
  cartDiscount?: CartDiscount
): DiscountCalculationResult {
  // Step 1: Calculate line item discounts
  const lineResults = lineItems.map((item) => {
    const grossLineBefore = item.quantity * item.unit_price
    const lineDiscountAmount = item.discount
      ? calculateLineDiscount(item.quantity, item.unit_price, item.discount)
      : 0
    const netLine = Math.max(0, grossLineBefore - lineDiscountAmount) // Prevent negative

    return {
      gross_line_before: grossLineBefore,
      line_discount_amount: lineDiscountAmount,
      net_line: netLine,
    }
  })

  // Step 2: Calculate subtotals
  const subtotalBeforeDiscount = lineResults.reduce(
    (sum, line) => sum + line.gross_line_before,
    0
  )

  const totalLineDiscount = lineResults.reduce(
    (sum, line) => sum + line.line_discount_amount,
    0
  )

  const subtotalAfterLineDiscounts = lineResults.reduce(
    (sum, line) => sum + line.net_line,
    0
  )

  // Step 3: Calculate cart discount
  const cartDiscountAmount = cartDiscount
    ? calculateCartDiscount(subtotalAfterLineDiscounts, cartDiscount)
    : 0

  // Step 4: Final totals
  const totalDiscount = totalLineDiscount + cartDiscountAmount
  const subtotalAfterDiscount = Math.max(
    0,
    subtotalAfterLineDiscounts - cartDiscountAmount
  ) // Prevent negative

  return {
    lineItems: lineResults,
    subtotal_before_discount: subtotalBeforeDiscount,
    total_line_discount: totalLineDiscount,
    subtotal_after_line_discounts: subtotalAfterLineDiscounts,
    cart_discount_amount: cartDiscountAmount,
    total_discount: totalDiscount,
    subtotal_after_discount: subtotalAfterDiscount,
  }
}

/**
 * Allocate cart discount proportionally across line items
 * Used for tax calculation on individual lines
 */
export function allocateCartDiscount(
  lineItems: Array<{ net_line: number }>,
  cartDiscountAmount: number,
  subtotalAfterLineDiscounts: number
): number[] {
  if (cartDiscountAmount <= 0 || subtotalAfterLineDiscounts <= 0) {
    return lineItems.map(() => 0)
  }

  // Allocate proportionally based on net line amounts
  return lineItems.map((line) => {
    if (line.net_line <= 0) return 0
    const proportion = line.net_line / subtotalAfterLineDiscounts
    return cartDiscountAmount * proportion
  })
}
