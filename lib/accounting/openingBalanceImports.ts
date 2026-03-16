/**
 * Opening Balance Imports - Canonical Payload Builder
 * 
 * This module provides deterministic, idempotent transformation of opening balance
 * imports to canonical format for posting to the ledger. It ensures:
 * - Same import → same hash → same ledger entry
 * - No duplicate posts
 * - Full audit trail
 * 
 * Opening balances are the entry point for Accountant-First mode.
 */

import crypto from "crypto"

export type OpeningBalanceLine = {
  account_id: string
  debit: number
  credit: number
  memo?: string | null
}

export type OpeningBalanceImport = {
  id: string
  accounting_firm_id: string
  client_business_id: string
  period_id: string
  source_type: "manual" | "csv" | "excel"
  lines: OpeningBalanceLine[]
  total_debit: number
  total_credit: number
  approved_by: string | null
}

export type CanonicalOpeningBalancePayload = {
  // Import metadata
  import_id: string
  firm_id: string
  client_business_id: string
  period_id: string
  source_type: "manual" | "csv" | "excel"
  
  // Lines (normalized and ordered)
  lines: NormalizedOpeningBalanceLine[]
  
  // Totals
  total_debit: string // Fixed precision string
  total_credit: string // Fixed precision string
  
  // Approval metadata
  approved_by: string | null
  
  // Hash
  input_hash: string
}

export type NormalizedOpeningBalanceLine = {
  account_id: string
  debit: string // Fixed precision string
  credit: string // Fixed precision string
  memo: string // Normalized (empty string if null)
  index: number // Original array index for stable ordering
}

/**
 * Normalize a numeric value to fixed precision string (2 decimal places)
 */
function normalizeAmount(amount: number): string {
  return amount.toFixed(2)
}

/**
 * Normalize memo (null/undefined → empty string, trim whitespace)
 */
function normalizeMemo(memo: string | null | undefined): string {
  if (!memo) return ""
  return memo.trim()
}

/**
 * Normalize and sort lines for deterministic hashing
 * Preserves original order via index field
 */
function normalizeOpeningBalanceLines(
  lines: OpeningBalanceLine[]
): NormalizedOpeningBalanceLine[] {
  return lines.map((line, index) => ({
    account_id: line.account_id,
    debit: normalizeAmount(line.debit || 0),
    credit: normalizeAmount(line.credit || 0),
    memo: normalizeMemo(line.memo),
    index,
  }))
}

/**
 * Build canonical opening balance payload from import
 * 
 * This function creates a deterministic, normalized representation of the opening
 * balance import that will be used for:
 * 1. Computing input hash (for duplicate detection)
 * 2. Creating ledger entry (exact mapping)
 * 
 * Opening balances behave like a special manual journal entry and are posted
 * once per business.
 * 
 * @param importData - The opening balance import to transform
 * @returns Canonical opening balance payload with input hash
 */
export function buildCanonicalOpeningBalancePayload(
  importData: OpeningBalanceImport
): CanonicalOpeningBalancePayload {
  // Normalize lines (preserve order via index)
  const normalizedLines = normalizeOpeningBalanceLines(importData.lines)

  // Build hash inputs in deterministic order
  const hashInputs = [
    importData.id,
    importData.accounting_firm_id,
    importData.client_business_id,
    importData.period_id,
    importData.source_type,
    // Lines: ordered by index, then by account_id for stability
    JSON.stringify(
      normalizedLines.sort((a, b) => {
        if (a.index !== b.index) return a.index - b.index
        return a.account_id.localeCompare(b.account_id)
      })
    ),
    normalizeAmount(importData.total_debit),
    normalizeAmount(importData.total_credit),
    importData.approved_by || "",
  ]

  // Compute SHA-256 hash
  const hashString = hashInputs.join("|")
  const inputHash = crypto.createHash("sha256").update(hashString).digest("hex")

  return {
    import_id: importData.id,
    firm_id: importData.accounting_firm_id,
    client_business_id: importData.client_business_id,
    period_id: importData.period_id,
    source_type: importData.source_type,
    lines: normalizedLines.sort((a, b) => a.index - b.index), // Restore original order
    total_debit: normalizeAmount(importData.total_debit),
    total_credit: normalizeAmount(importData.total_credit),
    approved_by: importData.approved_by,
    input_hash: inputHash,
  }
}

/**
 * Validate canonical opening balance payload
 * Ensures all required fields are present and valid
 */
export function validateCanonicalOpeningBalancePayload(
  payload: CanonicalOpeningBalancePayload
): { valid: boolean; error?: string } {
  if (!payload.import_id) {
    return { valid: false, error: "Missing import_id" }
  }
  if (!payload.firm_id) {
    return { valid: false, error: "Missing firm_id" }
  }
  if (!payload.client_business_id) {
    return { valid: false, error: "Missing client_business_id" }
  }
  if (!payload.period_id) {
    return { valid: false, error: "Missing period_id" }
  }
  if (!payload.source_type) {
    return { valid: false, error: "Missing source_type" }
  }
  if (!["manual", "csv", "excel"].includes(payload.source_type)) {
    return { valid: false, error: "Invalid source_type" }
  }
  if (!payload.lines || payload.lines.length === 0) {
    return { valid: false, error: "Missing or empty lines" }
  }
  if (!payload.input_hash) {
    return { valid: false, error: "Missing input_hash" }
  }

  // Validate balance
  const totalDebit = parseFloat(payload.total_debit)
  const totalCredit = parseFloat(payload.total_credit)
  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    return {
      valid: false,
      error: `Payload is not balanced. Debit: ${totalDebit}, Credit: ${totalCredit}`,
    }
  }

  // Validate lines
  for (const line of payload.lines) {
    if (!line.account_id) {
      return { valid: false, error: "Line missing account_id" }
    }
    const debit = parseFloat(line.debit)
    const credit = parseFloat(line.credit)
    if (debit < 0 || credit < 0) {
      return { valid: false, error: "Line has negative amount" }
    }
    if (debit > 0 && credit > 0) {
      return { valid: false, error: "Line has both debit and credit" }
    }
    if (debit === 0 && credit === 0) {
      return { valid: false, error: "Line has zero amounts" }
    }
  }

  return { valid: true }
}
