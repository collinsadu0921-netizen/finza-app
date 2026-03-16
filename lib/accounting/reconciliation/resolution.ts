/**
 * Reconciliation mismatch resolution — diagnosis and fix recommendation.
 * READ-ONLY: never mutates ledger or operational data.
 * All fixes via new journal entries only. No auto-fix. approval_required=true.
 * reference_id is deterministic from result so proposal_hash is reproducible.
 */

import crypto from "crypto"
import type { ReconciliationResult, ReconciliationScope } from "./types"
import { ReconciliationStatus } from "./types"
import type {
  MismatchSeverity,
  RootCause,
  RootCauseLegacy,
  FixPattern,
  DiagnosisReport,
  FixRecommendation,
  ResolutionReport,
  ProposedJournalEntry,
  ProposedJournalEntryLine,
  ResolutionAuditMetadata,
  CauseWithConfidence,
  ConfidenceLevel,
  DeltaClassification,
  DiagnosisStrict,
  LedgerCorrectionProposal,
  ProposedFixStrict,
  ProposedJournalEntryStrict,
  ProposedJELineStrict,
  AuditMetadataStrict,
  VerificationPlanStrict,
  FixPatternStrict,
} from "./resolution-types"

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const ROUNDING_THRESHOLD = 0.01
const MINOR_THRESHOLD = 1

/**
 * Classify mismatch by |delta|:
 * - |delta| ≤ 0.01 → rounding drift
 * - 0.01 < |delta| < 1 → minor inconsistency
 * - |delta| ≥ 1 → structural error
 */
export function classifyMismatch(result: ReconciliationResult): MismatchSeverity {
  if (result.delta == null) return "engine_error"
  const absDelta = Math.abs(result.delta)
  if (absDelta <= ROUNDING_THRESHOLD) return "rounding_drift"
  if (absDelta < MINOR_THRESHOLD) return "minor_inconsistency"
  return "structural_error"
}

// ---------------------------------------------------------------------------
// Root cause inference (heuristic from delta and scope)
// ---------------------------------------------------------------------------

/**
 * Infer likely root cause from delta sign and magnitude.
 * delta = ledgerBalance - expectedBalance.
 * Ledger high (delta > 0) → duplicate or missing credit/payment application.
 * Ledger low (delta < 0) → missing posting or partial posting.
 */
export function inferRootCause(result: ReconciliationResult): RootCauseLegacy | null {
  const { delta, scope } = result
  if (delta == null) return null
  const absDelta = Math.abs(delta)
  if (absDelta <= ROUNDING_THRESHOLD) return null
  if (delta > 0) return "duplicate_posting"
  if (scope.invoiceId) return absDelta >= MINOR_THRESHOLD ? "missing_journal_entry" : "partial_posting"
  return "missing_journal_entry"
}

/**
 * Evidence-based possible causes with confidence. DO NOT GUESS.
 * Uses only: delta sign, |delta|, scope (invoiceId, customerId).
 */
export function inferPossibleCausesWithConfidence(result: ReconciliationResult): CauseWithConfidence[] {
  const { delta, scope } = result
  if (delta == null) return []
  const absDelta = Math.abs(delta)
  if (absDelta <= ROUNDING_THRESHOLD) return []
  const hasInvoice = !!scope.invoiceId
  const out: CauseWithConfidence[] = []
  if (delta > 0) {
    out.push({ cause: "duplicate_posting", confidence: absDelta >= MINOR_THRESHOLD ? "HIGH" : "MEDIUM" })
    if (hasInvoice) {
      out.push({ cause: "missing_credit_note_posting", confidence: "LOW" })
      out.push({ cause: "missing_payment_posting", confidence: "LOW" })
    }
  } else {
    if (hasInvoice) {
      out.push({ cause: "missing_invoice_posting", confidence: absDelta >= MINOR_THRESHOLD ? "HIGH" : "MEDIUM" })
      out.push({ cause: "partial_posting", confidence: absDelta < MINOR_THRESHOLD ? "MEDIUM" : "LOW" })
      out.push({ cause: "missing_payment_posting", confidence: "LOW" })
      out.push({ cause: "missing_credit_note_posting", confidence: "LOW" })
    } else {
      out.push({ cause: "missing_invoice_posting", confidence: "MEDIUM" })
      out.push({ cause: "partial_posting", confidence: "MEDIUM" })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Fix-pattern selection (legacy and strict)
// ---------------------------------------------------------------------------

function selectFixPattern(rootCause: RootCauseLegacy | null, result: ReconciliationResult): FixPattern | null {
  if (!rootCause) return null
  switch (rootCause) {
    case "missing_journal_entry":
    case "partial_posting":
    case "payment_je_missing":
    case "credit_note_je_missing":
      return "missing_posting_adjustment"
    case "duplicate_posting":
      return "duplicate_posting_reversal"
    case "wrong_tax_posting":
      return "tax_only_adjustment"
    default:
      return "missing_posting_adjustment"
  }
}

/** Pick ONE fix pattern (A–D) from highest-confidence cause. */
function selectFixPatternStrict(causes: CauseWithConfidence[], delta: number): FixPatternStrict {
  const primary = causes[0]
  if (!primary) return "A_adjustment_je"
  switch (primary.cause) {
    case "duplicate_posting":
      return "B_reversal_je"
    case "tax_line_mismatch":
      return "C_tax_only_adjustment_je"
    case "missing_payment_posting":
    case "missing_credit_note_posting":
      return "D_ar_cash_correction_je"
    default:
      return "A_adjustment_je"
  }
}

// ---------------------------------------------------------------------------
// Journal entry structure builders (AR-focused; codes 1100/1200 AR, 4000 Revenue)
// ---------------------------------------------------------------------------

function buildARAdjustmentLines(
  _scope: ReconciliationScope,
  amount: number,
  isReversal: boolean
): ProposedJournalEntryLine[] {
  // amount = |delta|; we move AR by that amount
  // If ledger is high (we inferred duplicate) → reversal: Credit AR to reduce
  // If ledger is low (we inferred missing) → adjustment: Debit AR to increase
  const absAmount = Math.round(Math.abs(amount) * 100) / 100
  if (absAmount <= 0) return []

  if (isReversal) {
    // Reduce AR: Credit AR (and Debit Revenue or suspense for double-entry)
    return [
      { account_code: "4000", debit: absAmount, credit: 0, description: "Reversal: reduce AR (revenue side)" },
      { account_code: "1100", debit: 0, credit: absAmount, description: "Reversal: reduce AR" },
    ]
  }
  // Increase AR: Debit AR, Credit Revenue (missing posting)
  return [
    { account_code: "1100", debit: absAmount, credit: 0, description: "Adjustment: add missing AR posting" },
    { account_code: "4000", debit: 0, credit: absAmount, description: "Adjustment: add missing revenue posting" },
  ]
}

function buildReversalLines(scope: ReconciliationScope, delta: number): ProposedJournalEntryLine[] {
  // delta > 0 → ledger high → reverse the excess
  const amount = Math.round(Math.abs(delta) * 100) / 100
  return buildARAdjustmentLines(scope, amount, true)
}

function buildAdjustmentLines(scope: ReconciliationScope, delta: number): ProposedJournalEntryLine[] {
  // delta < 0 → ledger low → add missing amount
  const amount = Math.round(Math.abs(delta) * 100) / 100
  return buildARAdjustmentLines(scope, amount, false)
}

/** Build strict lines { account_code, debit, credit } only; debits = credits. */
function buildStrictLines(
  delta: number,
  pattern: FixPatternStrict
): ProposedJELineStrict[] {
  const amount = Math.round(Math.abs(delta) * 100) / 100
  if (amount <= 0) return []
  const isReversal = pattern === "B_reversal_je" && delta > 0
  if (isReversal) {
    return [
      { account_code: "4000", debit: amount, credit: 0 },
      { account_code: "1100", debit: 0, credit: amount },
    ]
  }
  if (pattern === "D_ar_cash_correction_je") {
    if (delta > 0) {
      return [
        { account_code: "1100", debit: 0, credit: amount },
        { account_code: "1000", debit: amount, credit: 0 },
      ]
    }
    return [
      { account_code: "1100", debit: amount, credit: 0 },
      { account_code: "1000", debit: 0, credit: amount },
    ]
  }
  return [
    { account_code: "1100", debit: amount, credit: 0 },
    { account_code: "4000", debit: 0, credit: amount },
  ]
}

function randomUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Deterministic reference_id from result so proposal_hash is reproducible (hash-locked). */
function deterministicProposalReferenceId(result: ReconciliationResult): string {
  const payload = JSON.stringify({
    delta: Number(result.delta),
    expectedBalance: Number(result.expectedBalance),
    ledgerBalance: Number(result.ledgerBalance),
    scope: {
      businessId: result.scope.businessId,
      customerId: result.scope.customerId,
      invoiceId: result.scope.invoiceId,
      periodId: result.scope.periodId,
    },
  })
  const hex = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 36)
  return `recon-${hex}`
}

// ---------------------------------------------------------------------------
// Audit metadata builder
// ---------------------------------------------------------------------------

function buildAuditMetadata(
  result: ReconciliationResult,
  reason: string,
  reference: string
): ResolutionAuditMetadata {
  return {
    reason,
    reference,
    scope: result.scope,
    timestamp: new Date().toISOString(),
    delta: result.delta,
    approval_required: true,
    reconciliation_result_summary: {
      expectedBalance: result.expectedBalance,
      ledgerBalance: result.ledgerBalance,
      status: result.status,
    },
  }
}

// ---------------------------------------------------------------------------
// Diagnosis report builder
// ---------------------------------------------------------------------------

export function buildDiagnosisReport(result: ReconciliationResult): DiagnosisReport {
  const severity = classifyMismatch(result)
  const rootCause = inferRootCause(result)
  const evidence: string[] =
    result.delta != null
      ? [
          `delta = ledgerBalance - expectedBalance = ${result.delta.toFixed(2)}`,
          `|delta| classifies as ${severity}`,
        ]
      : ["Engine/system failure; delta was not computed."]
  if (result.scope.invoiceId) evidence.push(`scope: invoice ${result.scope.invoiceId}`)
  if (result.scope.customerId) evidence.push(`scope: customer ${result.scope.customerId}`)
  if (rootCause) evidence.push(`inferred root cause: ${rootCause}`)

  const canRecommendFix =
    result.status !== ReconciliationStatus.OK &&
    result.status !== ReconciliationStatus.ERROR &&
    result.delta != null &&
    result.scope.businessId &&
    (result.scope.invoiceId ?? result.scope.customerId) != null

  let summary: string
  if (result.status === ReconciliationStatus.OK) {
    summary = "No mismatch; reconciliation OK."
  } else if (result.delta == null) {
    summary = "Reconciliation could not be run (engine error)."
  } else {
    summary = `AR mismatch: ledger ${result.ledgerBalance.toFixed(2)} vs expected ${result.expectedBalance.toFixed(2)} (delta ${result.delta.toFixed(2)}). Severity: ${severity}.`
    if (rootCause) summary += ` Inferred cause: ${rootCause}.`
  }

  return {
    result,
    severity,
    rootCause,
    summary,
    evidence,
    canRecommendFix,
  }
}

// ---------------------------------------------------------------------------
// Fix recommendation builder
// ---------------------------------------------------------------------------

export function buildFixRecommendation(
  result: ReconciliationResult,
  diagnosis: DiagnosisReport
): FixRecommendation | null {
  if (!diagnosis.canRecommendFix || diagnosis.rootCause == null || result.delta == null) return null

  const pattern = selectFixPattern(diagnosis.rootCause, result)
  if (!pattern) return null

  const scope = result.scope
  const refId = scope.invoiceId ?? scope.customerId ?? scope.periodId ?? "unknown"
  const reference = `reconciliation-fix-${scope.businessId}-${refId}-${Date.now()}`
  const date = new Date().toISOString().slice(0, 10)

  let lines: ProposedJournalEntryLine[]
  let description: string
  let reason: string

  switch (pattern) {
    case "duplicate_posting_reversal":
      lines = buildReversalLines(scope, result.delta)
      description = `Reversal: duplicate AR posting (delta ${result.delta.toFixed(2)})`
      reason = "Ledger exceeds operational balance; reverse duplicate posting via new JE."
      break
    case "missing_posting_adjustment":
      lines = buildAdjustmentLines(scope, result.delta)
      description = `Adjustment: missing AR posting (delta ${result.delta.toFixed(2)})`
      reason = "Ledger below operational balance; add missing posting via adjustment JE."
      break
    case "tax_only_adjustment":
      // Placeholder: tax-only would need tax account codes; use same structure as adjustment for now
      lines = buildAdjustmentLines(scope, result.delta)
      description = `Tax-only adjustment: AR/tax mismatch (delta ${result.delta.toFixed(2)})`
      reason = "Tax posting mismatch; adjust via tax-related JE (review account codes)."
      break
    case "payment_ar_adjustment":
      lines = buildAdjustmentLines(scope, result.delta)
      description = `Payment/AR adjustment: bank-AR mismatch (delta ${result.delta.toFixed(2)})`
      reason = "Payment or AR posting mismatch; adjust via bank/AR JE."
      break
    default:
      lines = buildAdjustmentLines(scope, result.delta)
      description = `AR adjustment (delta ${result.delta.toFixed(2)})`
      reason = "Reconciliation mismatch; correct via adjustment JE."
  }

  const journalEntry: ProposedJournalEntry = {
    business_id: scope.businessId,
    date,
    description,
    reference_type: pattern === "duplicate_posting_reversal" ? "reconciliation_reversal" : "reconciliation_adjustment",
    reference_id: reference,
    lines,
  }

  const auditMetadata = buildAuditMetadata(result, reason, reference)

  return {
    pattern,
    description: `${pattern}: ${description}`,
    journalEntry,
    auditMetadata,
    verificationRequirement: {
      reRunReconciliation: true,
      requiredDelta: 0,
      requiredStatus: "OK",
    },
  }
}

// ---------------------------------------------------------------------------
// Full resolution report
// ---------------------------------------------------------------------------

/**
 * Produce diagnosis report and fix recommendation from a reconciliation result.
 * Does not post anything; does not mutate data. Output is intent-only; posting
 * requires separate, approval-gated action.
 */
export function produceResolutionReport(result: ReconciliationResult): ResolutionReport {
  const diagnosis = buildDiagnosisReport(result)
  const fixRecommendation = buildFixRecommendation(result, diagnosis)

  let noFixReason: string | undefined
  if (!fixRecommendation) {
    if (result.status === ReconciliationStatus.OK) noFixReason = "reconciliation_ok"
    else if (result.status === ReconciliationStatus.ERROR || result.delta == null) noFixReason = "engine_error"
    else if (!diagnosis.rootCause) noFixReason = "root_cause_ambiguous"
    else if (!diagnosis.canRecommendFix) noFixReason = "manual_review_required"
    else noFixReason = "manual_review_required"
  }

  return {
    diagnosis,
    fixRecommendation,
    noFixReason,
  }
}

// ---------------------------------------------------------------------------
// Strict output — Ledger correction proposal (structure only, no execution)
// ---------------------------------------------------------------------------

function classifyDelta(result: ReconciliationResult): DeltaClassification {
  if (result.delta == null) return "engine_error"
  const absDelta = Math.abs(result.delta)
  if (absDelta <= ROUNDING_THRESHOLD) return "rounding_drift"
  if (absDelta < MINOR_THRESHOLD) return "minor_inconsistency"
  return "structural_error"
}

/**
 * Produce a ledger correction proposal in strict output format.
 * Structure only. No SQL, no mutations, no execution. Every fix requires human approval.
 * Returns proposal with proposed_fix = null when status === ERROR or delta === 0.
 *
 * OUTPUT: { diagnosis, proposed_fix, audit_metadata, verification_plan }
 */
export function produceLedgerCorrectionProposal(result: ReconciliationResult): LedgerCorrectionProposal {
  const classification = classifyDelta(result)
  const possible_causes = inferPossibleCausesWithConfidence(result)

  // ERROR or zero-delta: no proposed fix; minimal diagnosis/audit.
  if (result.status === ReconciliationStatus.ERROR || result.delta == null) {
    const evidence: string[] = ["Engine/system failure; delta was not computed."]
    if (result.scope.invoiceId) evidence.push(`scope: invoice ${result.scope.invoiceId}`)
    if (result.scope.customerId) evidence.push(`scope: customer ${result.scope.customerId}`)
    if (result.scope.periodId) evidence.push(`scope: period ${result.scope.periodId}`)
    const summary = "Reconciliation could not be run (engine error). No accounting fix."
    const diagnosis: DiagnosisStrict = {
      classification: "engine_error",
      possible_causes: [],
      evidence,
      summary,
    }
    const reconciliation_to_re_run = result.scope.invoiceId
      ? `Invoice ${result.scope.invoiceId}`
      : result.scope.customerId
        ? `Customer ${result.scope.customerId}`
        : result.scope.periodId
          ? `Period ${result.scope.periodId}`
          : `Business ${result.scope.businessId}`
    return {
      diagnosis,
      proposed_fix: null,
      audit_metadata: {
        reason: "No fix required; engine error.",
        detected_delta: null,
        before_balance: result.ledgerBalance,
        after_balance: result.expectedBalance,
        confidence_level: "MEDIUM",
        approval_required: true,
      },
      verification_plan: {
        reconciliation_to_re_run,
        expected_delta: 0,
        expected_status: "OK",
      },
    }
  }

  // Zero-delta invariant: do not propose fix when delta === 0 (status must be OK; double-check).
  if (result.delta === 0) {
    const evidence: string[] = [
      `delta = ledgerBalance - expectedBalance = 0`,
      `|delta| classifies as ${classification}`,
    ]
    if (result.scope.invoiceId) evidence.push(`scope: invoice ${result.scope.invoiceId}`)
    if (result.scope.customerId) evidence.push(`scope: customer ${result.scope.customerId}`)
    if (result.scope.periodId) evidence.push(`scope: period ${result.scope.periodId}`)
    const summary = "No mismatch; reconciliation OK."
    const diagnosis: DiagnosisStrict = {
      classification: "rounding_drift",
      possible_causes: [],
      evidence,
      summary,
    }
    const reconciliation_to_re_run = result.scope.invoiceId
      ? `Invoice ${result.scope.invoiceId}`
      : result.scope.customerId
        ? `Customer ${result.scope.customerId}`
        : result.scope.periodId
          ? `Period ${result.scope.periodId}`
          : `Business ${result.scope.businessId}`
    return {
      diagnosis,
      proposed_fix: null,
      audit_metadata: {
        reason: "No fix required; delta is zero.",
        detected_delta: 0,
        before_balance: result.ledgerBalance,
        after_balance: result.expectedBalance,
        confidence_level: "MEDIUM",
        approval_required: true,
      },
      verification_plan: {
        reconciliation_to_re_run,
        expected_delta: 0,
        expected_status: "OK",
      },
    }
  }

  const evidence: string[] = [
    `delta = ledgerBalance - expectedBalance = ${result.delta.toFixed(2)}`,
    `|delta| classifies as ${classification}`,
  ]
  if (result.scope.invoiceId) evidence.push(`scope: invoice ${result.scope.invoiceId}`)
  if (result.scope.customerId) evidence.push(`scope: customer ${result.scope.customerId}`)
  if (result.scope.periodId) evidence.push(`scope: period ${result.scope.periodId}`)
  possible_causes.forEach((c) => evidence.push(`possible cause: ${c.cause} (${c.confidence})`))

  const summary =
    result.status === ReconciliationStatus.OK
      ? "No mismatch; reconciliation OK."
      : `AR mismatch: ledger ${result.ledgerBalance.toFixed(2)} vs expected ${result.expectedBalance.toFixed(2)} (delta ${result.delta.toFixed(2)}). Classification: ${classification}.`

  const diagnosis: DiagnosisStrict = {
    classification,
    possible_causes,
    evidence,
    summary,
  }

  const confidence_level: ConfidenceLevel =
    possible_causes[0]?.confidence ?? "MEDIUM"

  const audit_metadata: AuditMetadataStrict = {
    reason:
      result.status === ReconciliationStatus.OK
        ? "No fix required."
        : `Ledger balance (${result.ledgerBalance.toFixed(2)}) differs from operational expected (${result.expectedBalance.toFixed(2)}). Proposed correction resolves delta ${result.delta.toFixed(2)}.`,
    detected_delta: result.delta,
    before_balance: result.ledgerBalance,
    after_balance: result.expectedBalance,
    confidence_level,
    approval_required: true,
  }

  const reconciliation_to_re_run = result.scope.invoiceId
    ? `Invoice ${result.scope.invoiceId}`
    : result.scope.customerId
      ? `Customer ${result.scope.customerId}`
      : result.scope.periodId
        ? `Period ${result.scope.periodId}`
        : `Business ${result.scope.businessId}`

  const verification_plan: VerificationPlanStrict = {
    reconciliation_to_re_run,
    expected_delta: 0,
    expected_status: "OK",
  }

  let proposed_fix: ProposedFixStrict | null = null
  if (
    result.status !== ReconciliationStatus.OK &&
    result.status !== ReconciliationStatus.ERROR &&
    result.scope.businessId &&
    Math.abs(result.delta) > ROUNDING_THRESHOLD &&
    (result.scope.invoiceId ?? result.scope.customerId ?? result.scope.periodId)
  ) {
    const pattern = selectFixPatternStrict(possible_causes, result.delta)
    const lines = buildStrictLines(result.delta, pattern)
    const reference_id = deterministicProposalReferenceId(result)
    const isReversal = pattern === "B_reversal_je" && result.delta > 0
    const description =
      pattern === "B_reversal_je"
        ? `Reversal: duplicate AR posting (delta ${result.delta.toFixed(2)})`
        : pattern === "C_tax_only_adjustment_je"
          ? `Tax-only adjustment: AR/tax mismatch (delta ${result.delta.toFixed(2)})`
          : pattern === "D_ar_cash_correction_je"
            ? `AR ↔ Cash correction (delta ${result.delta.toFixed(2)})`
            : `Adjustment: balance correction (delta ${result.delta.toFixed(2)})`

    const journal_entry: ProposedJournalEntryStrict = {
      posting_source: isReversal ? "reconciliation_reversal" : "reconciliation_adjustment",
      description,
      reference_type: "reconciliation",
      reference_id,
      lines,
    }
    proposed_fix = { pattern, journal_entry }
  }

  return {
    diagnosis,
    proposed_fix,
    audit_metadata,
    verification_plan,
  }
}
