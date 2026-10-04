export type TenderMethod = "cash" | "momo" | "card"

/** A newly opened payment modal starts with no card or MoMo reference. */
export function singleTenderReferenceOnOpen(): string {
  return ""
}

/**
 * Card and MoMo references are not interchangeable.
 * Staying on the same tender keeps the reference the cashier is editing.
 */
export function singleTenderReferenceAfterMethodChange(
  currentMethod: TenderMethod,
  nextMethod: TenderMethod,
  currentReference: string
): string {
  if (currentMethod === nextMethod) return currentReference
  return ""
}

/**
 * One split line keeps its own reference. Changing that line's method drops
 * only that line's reference. Other lines are untouched.
 */
export function splitLineAfterMethodChange<T extends { method: TenderMethod; reference?: string | null }>(
  line: T,
  nextMethod: TenderMethod
): T {
  if (line.method === nextMethod) return line
  return { ...line, method: nextMethod, reference: undefined }
}
