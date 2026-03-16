/**
 * Manual Journal Draft Posting - Canonical Payload Builder
 * 
 * This module provides deterministic, idempotent posting of manual journal drafts
 * to the ledger. It ensures:
 * - Same draft → same hash → same ledger entry
 * - No duplicate posts
 * - Full audit trail
 */

import crypto from "crypto"

export type DraftLine = {
  account_id: string
  debit: number
  credit: number
  memo?: string | null
}

export type ManualJournalDraft = {
  id: string
  accounting_firm_id: string
  client_business_id: string
  period_id: string
  entry_date: string
  description: string
  lines: DraftLine[]
  total_debit: number
  total_credit: number
  approved_by: string | null
}

export type CanonicalPostingPayload = {
  // Draft metadata
  draft_id: string
  firm_id: string
  client_business_id: string
  period_id: string
  entry_date: string
  description: string
  
  // Lines (normalized and ordered)
  lines: NormalizedLine[]
  
  // Totals
  total_debit: string // Fixed precision string
  total_credit: string // Fixed precision string
  
  // Approval metadata
  approved_by: string | null
  
  // Hash
  input_hash: string
}

export type NormalizedLine = {
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
function normalizeLines(lines: DraftLine[]): NormalizedLine[] {
  return lines.map((line, index) => ({
    account_id: line.account_id,
    debit: normalizeAmount(line.debit || 0),
    credit: normalizeAmount(line.credit || 0),
    memo: normalizeMemo(line.memo),
    index,
  }))
}

/**
 * Build canonical posting payload from draft
 * 
 * This function creates a deterministic, normalized representation of the draft
 * that will be used for:
 * 1. Computing input hash (for duplicate detection)
 * 2. Creating ledger entry (exact mapping)
 * 
 * @param draft - The manual journal draft to post
 * @returns Canonical posting payload with input hash
 */
export function buildCanonicalPostingPayload(
  draft: ManualJournalDraft
): CanonicalPostingPayload {
  // Normalize lines (preserve order via index)
  const normalizedLines = normalizeLines(draft.lines)

  // Build hash inputs in deterministic order
  const hashInputs = [
    draft.id,
    draft.accounting_firm_id,
    draft.client_business_id,
    draft.period_id,
    draft.entry_date,
    draft.description,
    // Lines: ordered by index, then by account_id for stability
    JSON.stringify(
      normalizedLines.sort((a, b) => {
        if (a.index !== b.index) return a.index - b.index
        return a.account_id.localeCompare(b.account_id)
      })
    ),
    normalizeAmount(draft.total_debit),
    normalizeAmount(draft.total_credit),
    draft.approved_by || "",
  ]

  // Compute SHA-256 hash
  const hashString = hashInputs.join("|")
  const inputHash = crypto.createHash("sha256").update(hashString).digest("hex")

  return {
    draft_id: draft.id,
    firm_id: draft.accounting_firm_id,
    client_business_id: draft.client_business_id,
    period_id: draft.period_id,
    entry_date: draft.entry_date,
    description: draft.description,
    lines: normalizedLines.sort((a, b) => a.index - b.index), // Restore original order
    total_debit: normalizeAmount(draft.total_debit),
    total_credit: normalizeAmount(draft.total_credit),
    approved_by: draft.approved_by,
    input_hash: inputHash,
  }
}

/**
 * Validate canonical payload
 * Ensures all required fields are present and valid
 */
export function validateCanonicalPayload(
  payload: CanonicalPostingPayload
): { valid: boolean; error?: string } {
  if (!payload.draft_id) {
    return { valid: false, error: "Missing draft_id" }
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
  if (!payload.entry_date) {
    return { valid: false, error: "Missing entry_date" }
  }
  if (!payload.description || !payload.description.trim()) {
    return { valid: false, error: "Missing or empty description" }
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
