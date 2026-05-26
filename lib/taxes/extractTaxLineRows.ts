/**
 * Extract raw tax line rows from persisted `tax_lines` JSONB (recurring templates, etc.).
 *
 * - Does not apply UI display policy (COVID and zero-amount lines are kept).
 * - Does not parse string JSON; callers pass already-parsed values from JSON/JSONB.
 */

export function extractTaxLineRows(input: unknown): unknown[] | null {
  if (input == null) {
    return null
  }
  if (Array.isArray(input)) {
    return input
  }
  if (typeof input !== "object") {
    return null
  }
  const o = input as Record<string, unknown>
  if (Array.isArray(o.lines)) {
    return o.lines
  }
  if (Array.isArray(o.tax_lines)) {
    return o.tax_lines
  }
  return null
}
