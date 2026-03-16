/**
 * Reconciliation mismatch resolution — types only.
 * Ledger is source of truth. Fixes only via new journal entries. No auto-fix. All auditable.
 */

import type { ReconciliationResult, ReconciliationScope } from "./types"

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** |delta| ≤ 0.01 → rounding; 0.01 < |delta| < 1 → minor; |delta| ≥ 1 → structural; null delta → engine_error */
export type MismatchSeverity = "rounding_drift" | "minor_inconsistency" | "structural_error" | "engine_error"

/** Evidence-based root causes only. Do not guess. */
export type RootCause =
  | "missing_invoice_posting"
  | "missing_payment_posting"
  | "missing_credit_note_posting"
  | "duplicate_posting"
  | "tax_line_mismatch"
  | "partial_posting"

/** Legacy aliases for backward compatibility */
export type RootCauseLegacy =
  | "missing_journal_entry"
  | "duplicate_posting"
  | "partial_posting"
  | "wrong_tax_posting"
  | "payment_je_missing"
  | "credit_note_je_missing"

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW"

export interface CauseWithConfidence {
  cause: RootCause
  confidence: ConfidenceLevel
}

// ---------------------------------------------------------------------------
// Fix patterns (allowed only)
// ---------------------------------------------------------------------------

export type FixPattern =
  | "missing_posting_adjustment"   // A. Missing posting → adjustment JE
  | "duplicate_posting_reversal"   // B. Duplicate posting → reversal JE
  | "tax_only_adjustment"         // C. Tax mismatch → tax-only adjustment JE
  | "payment_ar_adjustment"        // D. Payment mismatch → bank/AR adjustment JE

// ---------------------------------------------------------------------------
// Journal entry structure (to be posted as new JE; never edit existing lines)
// ---------------------------------------------------------------------------

export interface ProposedJournalEntryLine {
  /** Chart of accounts code (e.g. 1100 AR, 4000 Revenue); poster resolves to account_id */
  account_code: string
  /** Resolved account UUID; set by poster when posting */
  account_id?: string
  debit: number
  credit: number
  description?: string
  /** Optional: reference_type for line-level tracking (e.g. invoice, payment) */
  reference_type?: string
  /** Optional: reference_id for line-level tracking */
  reference_id?: string
}

export interface ProposedJournalEntry {
  business_id: string
  date: string
  description: string
  reference_type: "reconciliation_adjustment" | "reconciliation_reversal"
  reference_id: string
  lines: ProposedJournalEntryLine[]
}

// ---------------------------------------------------------------------------
// Audit metadata (required on every fix recommendation)
// ---------------------------------------------------------------------------

export interface ResolutionAuditMetadata {
  reason: string
  reference: string
  scope: ReconciliationScope
  timestamp: string
  delta: number
  approval_required: true
  /** Link back to the reconciliation result that triggered this */
  reconciliation_result_summary: {
    expectedBalance: number
    ledgerBalance: number
    status: string
  }
}

// ---------------------------------------------------------------------------
// Diagnosis report
// ---------------------------------------------------------------------------

export interface DiagnosisReport {
  /** Input result */
  result: ReconciliationResult
  severity: MismatchSeverity
  /** Legacy single cause; use possible_causes in LedgerCorrectionProposal for evidence-based list */
  rootCause: RootCauseLegacy | null
  /** Human-readable summary */
  summary: string
  /** Evidence used to infer (e.g. delta sign, magnitude) */
  evidence: string[]
  /** Whether a fix recommendation can be produced from available data */
  canRecommendFix: boolean
}

// ---------------------------------------------------------------------------
// Fix recommendation
// ---------------------------------------------------------------------------

export interface FixRecommendation {
  pattern: FixPattern
  description: string
  /** Journal entry to post; caller must resolve account_id from codes if needed */
  journalEntry: ProposedJournalEntry
  auditMetadata: ResolutionAuditMetadata
  /** Verification requirement after posting */
  verificationRequirement: {
    reRunReconciliation: true
    requiredDelta: 0
    requiredStatus: "OK"
  }
}

// ---------------------------------------------------------------------------
// Full resolution output
// ---------------------------------------------------------------------------

export interface ResolutionReport {
  diagnosis: DiagnosisReport
  fixRecommendation: FixRecommendation | null
  /** When fixRecommendation is null, reason (e.g. "manual_review_required") */
  noFixReason?: string
}

// ---------------------------------------------------------------------------
// STRICT OUTPUT FORMAT — Ledger correction proposal (structure only, no execution)
// ---------------------------------------------------------------------------

/** Delta classification: STEP 1. engine_error when delta was never computed (status === ERROR). */
export type DeltaClassification = "rounding_drift" | "minor_inconsistency" | "structural_error" | "engine_error"

/** Journal entry line: account_code, debit, credit only */
export interface ProposedJELineStrict {
  account_code: string
  debit: number
  credit: number
}

/** Proposed JE structure — STEP 4 */
export interface ProposedJournalEntryStrict {
  posting_source: "reconciliation_adjustment" | "reconciliation_reversal"
  description: string
  reference_type: "reconciliation"
  reference_id: string
  lines: ProposedJELineStrict[]
}

/** Proposed fix — one pattern only (A–D) */
export type FixPatternStrict =
  | "A_adjustment_je"
  | "B_reversal_je"
  | "C_tax_only_adjustment_je"
  | "D_ar_cash_correction_je"

export interface ProposedFixStrict {
  pattern: FixPatternStrict
  journal_entry: ProposedJournalEntryStrict
}

/** Audit metadata — STEP 5. detected_delta null when status === ERROR. */
export interface AuditMetadataStrict {
  reason: string
  detected_delta: number | null
  before_balance: number
  after_balance: number
  confidence_level: ConfidenceLevel
  approval_required: true
}

/** Verification plan — STEP 6 */
export interface VerificationPlanStrict {
  reconciliation_to_re_run: string
  expected_delta: 0
  expected_status: "OK"
}

/** Diagnosis — STEP 1 + 2: classification and possible causes with confidence */
export interface DiagnosisStrict {
  classification: DeltaClassification
  possible_causes: CauseWithConfidence[]
  evidence: string[]
  summary: string
}

/** Strict output: diagnosis, proposed_fix, audit_metadata, verification_plan */
export interface LedgerCorrectionProposal {
  diagnosis: DiagnosisStrict
  /** Null when status OK or when no single fix can be recommended */
  proposed_fix: ProposedFixStrict | null
  audit_metadata: AuditMetadataStrict
  verification_plan: VerificationPlanStrict
}
