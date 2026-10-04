export type ManualTenderMethod = "cash" | "momo" | "card"

export type ManualTenderLine = {
  method: ManualTenderMethod
  amount: number
  reference?: string | null
}

const MAX_REFERENCE_LENGTH = 80

export function normalizeTenderReference(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_REFERENCE_LENGTH)
}

/**
 * Cash never needs a reference.
 * Card and manual MoMo do, unless the line is covered by an already-confirmed
 * sandbox provider reference (that path is not used for Shop #1 standalone terminals).
 */
export function missingManualTenderReference(lines: ManualTenderLine[]): boolean {
  return lines.some((line) => {
    if (!(line.method === "card" || line.method === "momo")) return false
    if (!(Number(line.amount) > 0)) return false
    return !normalizeTenderReference(line.reference)
  })
}

/**
 * Single non-cash tender: store that reference on sales.payment_reference.
 * Split with more than one non-cash line: leave the sale column empty and keep
 * each reference on payment_lines. Cash-only sales stay null.
 */
export function salePaymentReferenceFromLines(
  lines: ManualTenderLine[],
  sandboxProviderReference?: string | null
): string | null {
  const nonCash = lines.filter(
    (line) => (line.method === "card" || line.method === "momo") && Number(line.amount) > 0
  )
  const refs = nonCash
    .map((line) => normalizeTenderReference(line.reference))
    .filter((ref): ref is string => Boolean(ref))
  if (refs.length === 1 && nonCash.length === 1) return refs[0]
  if (refs.length === 0 && nonCash.length === 1) {
    return normalizeTenderReference(sandboxProviderReference)
  }
  return null
}

export function withNormalizedTenderReferences<T extends ManualTenderLine>(lines: T[]): T[] {
  return lines.map((line) => {
    if (line.method === "cash") {
      const { reference: _ignored, ...rest } = line
      return rest as T
    }
    const reference = normalizeTenderReference(line.reference)
    return reference ? { ...line, reference } : { ...line, reference: undefined }
  })
}
