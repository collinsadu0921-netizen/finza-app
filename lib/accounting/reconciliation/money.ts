/**
 * Canonical rounding helpers for reconciliation.
 * No DB calls. No dependencies.
 */

/**
 * Round to 2 decimal places (pennies).
 * Uses Number.EPSILON correction to prevent IEEE 754 half-rounding failures.
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Absolute value.
 */
export function abs(n: number): number {
  return Math.abs(n)
}

/**
 * True if |delta| <= tolerance.
 */
export function withinTolerance(delta: number, tolerance: number): boolean {
  return Math.abs(delta) <= tolerance
}
