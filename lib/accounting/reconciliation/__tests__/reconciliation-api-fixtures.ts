/**
 * Fixtures for reconciliation API tests.
 * ReconciliationResult and LedgerCorrectionProposal shapes — no real DB.
 */

import type { ReconciliationResult, ReconciliationScope } from "../types"
import type { LedgerCorrectionProposal, ProposedFixStrict } from "../resolution-types"
import { ReconciliationContext, ReconciliationStatus } from "../types"

const BUSINESS_ID = "b1000000-0000-0000-0000-000000000001"
const INVOICE_ID = "i2000000-0000-0000-0000-000000000002"

export const scopeInvoice: ReconciliationScope = {
  businessId: BUSINESS_ID,
  invoiceId: INVOICE_ID,
}

export const resultWarn: ReconciliationResult = {
  scope: scopeInvoice,
  context: ReconciliationContext.DISPLAY,
  expectedBalance: 100,
  ledgerBalance: 99.5,
  delta: -0.5,
  tolerance: 0.01,
  status: ReconciliationStatus.WARN,
  notes: ["Ledger below expected"],
}

export const resultFail: ReconciliationResult = {
  scope: scopeInvoice,
  context: ReconciliationContext.VALIDATE,
  expectedBalance: 100,
  ledgerBalance: 95,
  delta: -5,
  tolerance: 0,
  status: ReconciliationStatus.FAIL,
  notes: ["Structural delta"],
}

export const resultOk: ReconciliationResult = {
  scope: scopeInvoice,
  context: ReconciliationContext.DISPLAY,
  expectedBalance: 100,
  ledgerBalance: 100,
  delta: 0,
  tolerance: 0.01,
  status: ReconciliationStatus.OK,
}

export const proposedFixStrict: ProposedFixStrict = {
  pattern: "A_adjustment_je",
  journal_entry: {
    posting_source: "reconciliation_adjustment",
    description: "Adjustment: balance correction (delta -5.00)",
    reference_type: "reconciliation",
    reference_id: "r3000000-0000-0000-0000-000000000003",
    lines: [
      { account_code: "1100", debit: 5, credit: 0 },
      { account_code: "4000", debit: 0, credit: 5 },
    ],
  },
}

export const proposalWithFix: LedgerCorrectionProposal = {
  diagnosis: {
    classification: "structural_error",
    possible_causes: [{ cause: "missing_invoice_posting", confidence: "HIGH" }],
    evidence: ["delta = -5.00", "|delta| classifies as structural_error"],
    summary: "AR mismatch: ledger 95.00 vs expected 100.00 (delta -5.00).",
  },
  proposed_fix: proposedFixStrict,
  audit_metadata: {
    reason: "Ledger balance differs from operational expected.",
    detected_delta: -5,
    before_balance: 95,
    after_balance: 100,
    confidence_level: "HIGH",
    approval_required: true,
  },
  verification_plan: {
    reconciliation_to_re_run: `Invoice ${INVOICE_ID}`,
    expected_delta: 0,
    expected_status: "OK",
  },
}

export const proposalNullFix: LedgerCorrectionProposal = {
  ...proposalWithFix,
  proposed_fix: null,
}

export const clientSeen = {
  detected_delta: -5,
  ledgerBalance: 95,
  expectedBalance: 100,
}

export const resolveBodyValid = {
  businessId: BUSINESS_ID,
  scopeType: "invoice" as const,
  scopeId: INVOICE_ID,
  proposed_fix: proposedFixStrict,
  clientSeen,
}
