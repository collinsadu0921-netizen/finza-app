/**
 * Document-level VAT classification for VAT return taxable bases.
 *
 * Unknown documents stay `unclassified`; they are never silently assigned to
 * zero-rated or exempt. A classification that conflicts with the document's
 * tax evidence is rejected.
 */

export type VatClassification =
  | "standard"
  | "zero"
  | "exempt"
  | "out_of_scope"
  | "mixed"
  | "unclassified"

const VALID: VatClassification[] = [
  "standard",
  "zero",
  "exempt",
  "out_of_scope",
  "mixed",
  "unclassified",
]

export type TaxLineEvidence = {
  code?: string | null
  amount?: number | null
}

export type VatClassificationResult =
  | { ok: true; classification: VatClassification }
  | { ok: false; code: string; message: string }

function lineAmount(lines: TaxLineEvidence[], code: string): number {
  return lines
    .filter((line) => String(line.code || "").toUpperCase() === code)
    .reduce((sum, line) => {
      const n = Number(line.amount ?? 0)
      return sum + (Number.isFinite(n) ? n : 0)
    }, 0)
}

export function resolveDocumentVatClassification(input: {
  requested?: string | null
  taxLines?: TaxLineEvidence[] | null
  totalTax?: number | null
}): VatClassificationResult {
  const lines = Array.isArray(input.taxLines) ? input.taxLines : []
  const totalTax = Number(input.totalTax ?? 0)
  const vat = lineAmount(lines, "VAT")
  const nhil = lineAmount(lines, "NHIL")
  const getfund = lineAmount(lines, "GETFUND")
  const covid = lineAmount(lines, "COVID")
  const zeroLine = lineAmount(lines, "ZERO")
  const exemptLine = lineAmount(lines, "EXEMPT")
  const hasTaxEvidence =
    totalTax > 0.009 || vat > 0.009 || nhil > 0.009 || getfund > 0.009 || covid > 0.009

  const rawRequested =
    typeof input.requested === "string" ? input.requested.trim() : ""
  const requested = rawRequested
    ? (rawRequested as VatClassification)
    : null

  if (requested && !VALID.includes(requested)) {
    return {
      ok: false,
      code: "VAT_CLASSIFICATION_INVALID",
      message: "Select a valid VAT classification.",
    }
  }

  if (requested === "mixed") {
    return {
      ok: false,
      code: "VAT_CLASSIFICATION_MIXED_UNSUPPORTED",
      message:
        "Mixed standard/zero/exempt documents require line-level classification. Split the document or use a single classification.",
    }
  }

  if (requested === "standard") {
    if (!hasTaxEvidence) {
      return {
        ok: false,
        code: "VAT_CLASSIFICATION_CONFLICT",
        message:
          "A standard-rated document must have tax evidence. Leave the document unclassified or select zero-rated/exempt.",
      }
    }
    return { ok: true, classification: "standard" }
  }

  if (
    requested === "zero" ||
    requested === "exempt" ||
    requested === "out_of_scope"
  ) {
    if (hasTaxEvidence) {
      return {
        ok: false,
        code: "VAT_CLASSIFICATION_CONFLICT",
        message:
          "A zero-rated, exempt or out-of-scope document cannot contain VAT, NHIL, GETFund or COVID tax.",
      }
    }
    return { ok: true, classification: requested }
  }

  if (requested === "unclassified") {
    return { ok: true, classification: "unclassified" }
  }

  // No explicit request: derive only from evidence. Unknown stays unclassified.
  if (hasTaxEvidence) return { ok: true, classification: "standard" }
  if (zeroLine > 0.009) return { ok: true, classification: "zero" }
  if (exemptLine > 0.009) return { ok: true, classification: "exempt" }
  return { ok: true, classification: "unclassified" }
}
