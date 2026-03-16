/**
 * Deterministic payload for proposal hash (shared by server and browser).
 * Server hashes with Node crypto; browser with crypto.subtle.
 *
 * Full audit hash = SHA256(canonical(result + proposed_fix)). Reconciliation
 * proposals are hash-locked: resolve requires the exact proposal_hash returned
 * by /mismatches; re-run compares hash and returns 409 STALE_RECONCILIATION if
 * the proposal is stale.
 */

import type { ReconciliationResult, ReconciliationScope } from "./types"
import type { ProposedFixStrict } from "./resolution-types"

export interface ProposalFixForHash {
  pattern: string
  journal_entry: {
    description: string
    reference_type: string
    reference_id?: string | null
    lines: Array<{ account_code: string; debit: number; credit: number }>
  }
}

/** Canonical scope for hash: stable key order (alphabetical). */
function canonicalScope(scope: ReconciliationScope): Record<string, string | undefined> {
  return {
    businessId: scope.businessId,
    customerId: scope.customerId,
    invoiceId: scope.invoiceId,
    periodId: scope.periodId,
  }
}

/** Canonical result slice for full proposal hash: scope, expected, ledger, delta. Delta null for ERROR. */
function canonicalResult(result: ReconciliationResult): object {
  return {
    delta: result.delta != null ? Number(result.delta) : null,
    expectedBalance: Number(result.expectedBalance),
    ledgerBalance: Number(result.ledgerBalance),
    scope: canonicalScope(result.scope),
  }
}

/** Canonical JE lines: sorted by account_code, debit, credit. */
function canonicalJELines(
  lines: Array<{ account_code: string; debit: number; credit: number }>
): Array<{ account_code: string; debit: number; credit: number }> {
  const sorted = [...(lines ?? [])].sort((a, b) =>
    a.account_code.localeCompare(b.account_code) ||
    Number(a.debit) - Number(b.debit) ||
    Number(a.credit) - Number(b.credit)
  )
  return sorted.map((l) => ({
    account_code: l.account_code,
    debit: Number(l.debit),
    credit: Number(l.credit),
  }))
}

/** Canonical proposed_fix for full hash: pattern + journal_entry (posting_source, description, reference_type, reference_id, lines). */
function canonicalProposedFix(proposed_fix: ProposedFixStrict): object {
  const je = proposed_fix.journal_entry
  return {
    pattern: proposed_fix.pattern,
    journal_entry: {
      description: je.description,
      lines: canonicalJELines(je.lines),
      posting_source: je.posting_source,
      reference_id: je.reference_id ?? null,
      reference_type: je.reference_type,
    },
  }
}

/**
 * Full canonical payload for audit-grade proposal hash: result + proposed_fix.
 * Used by /mismatches (to attach proposal_hash) and /resolve (to verify hash after re-run).
 */
export function buildFullProposalHashPayload(
  result: ReconciliationResult,
  proposed_fix: ProposedFixStrict
): string {
  return JSON.stringify({
    proposed_fix: canonicalProposedFix(proposed_fix),
    result: canonicalResult(result),
  })
}

export function buildProposalHashPayload(proposed_fix: ProposalFixForHash): string {
  const je = proposed_fix.journal_entry
  const lines = canonicalJELines(je.lines ?? [])
  return JSON.stringify({
    pattern: proposed_fix.pattern,
    description: je.description,
    reference_type: je.reference_type,
    reference_id: je.reference_id ?? null,
    lines: lines.map((l) => ({
      account_code: l.account_code,
      debit: Number(l.debit),
      credit: Number(l.credit),
    })),
  })
}
