export type VatTaxClass = "output" | "input" | "settlement" | "unclassified"

const OUTPUT_TYPES = new Set([
  "invoice",
  "sale",
  "sale_return",
  "sale_void",
  "refund",
  "credit_note",
])
const INPUT_TYPES = new Set([
  "bill",
  "expense",
  "expense_reversal",
  "purchase",
  "purchase_return",
  "supplier_bill",
])
const SETTLEMENT_TYPES = new Set([
  "vat_return_payment",
  "vat_payment",
  "tax_payment",
])

/**
 * Classify a tax-account journal line by its economic source. Reversals inherit
 * the class of the journal they reverse. Unknown/manual adjustments stay
 * unclassified so a return cannot silently count them as input tax.
 */
export function classifyVatReference(
  referenceType: string | null | undefined,
  originalReferenceType?: string | null
): VatTaxClass {
  const ref = String(referenceType || "").toLowerCase()
  if (OUTPUT_TYPES.has(ref)) return "output"
  if (INPUT_TYPES.has(ref)) return "input"
  if (SETTLEMENT_TYPES.has(ref)) return "settlement"
  if (ref === "reversal") {
    return classifyVatReference(originalReferenceType, undefined)
  }
  return "unclassified"
}
