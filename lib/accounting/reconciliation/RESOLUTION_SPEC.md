# Reconciliation Mismatch Resolution Spec

Ledger is the single source of truth. Fixes only via **new** journal entries. No auto-fix. All auditable. Every fix requires human approval.

## STEP 1 — Classify Delta

| Condition | Classification |
|-----------|-----------------|
| \|delta\| ≤ 0.01 | rounding_drift |
| 0.01 < \|delta\| < 1 | minor_inconsistency |
| \|delta\| ≥ 1 | structural_error |

## STEP 2 — Infer Root Cause (evidence only)

Use evidence patterns only. DO NOT GUESS. If multiple causes possible, list all and mark confidence (HIGH | MEDIUM | LOW).

- **missing_invoice_posting** — Ledger low; invoice JE absent
- **missing_payment_posting** — Payment not reflected in ledger
- **missing_credit_note_posting** — Credit note not reflected in ledger
- **duplicate_posting** — Ledger high; same event posted twice
- **tax_line_mismatch** — Tax lines inconsistent with operational tax
- **partial_posting** — Ledger low; posting incomplete

## STEP 3 — Select Fix Pattern (ONE ONLY)

| Pattern | Action |
|---------|--------|
| A. Adjustment JE | Balance correction |
| B. Reversal JE | Undo duplicate |
| C. Tax-only adjustment JE | Tax mismatch only |
| D. AR ↔ Cash correction JE | Payment/AR ↔ bank correction |

## STEP 4 — Proposed Journal Entry (structure only)

```
journal_entry: {
  posting_source: "reconciliation_adjustment" | "reconciliation_reversal",
  description: "...",
  reference_type: "reconciliation",
  reference_id: "<uuid>",
  lines: [ { account_code, debit, credit }, ... ]
}
```

- Debits must equal credits
- Delta must be fully resolved
- Use correct AR (1100) / Revenue (4000) / Tax / Cash (1000) accounts
- Never invent accounts

## STEP 5 — Audit Metadata

- **reason**, **detected_delta**, **before_balance**, **after_balance**
- **confidence_level**: HIGH | MEDIUM | LOW
- **approval_required**: true

## STEP 6 — Verification Plan

- **reconciliation_to_re_run** — Which reconciliation (e.g. "Invoice {id}")
- **expected_delta**: 0
- **expected_status**: "OK"

## Strict Output Format

```ts
{
  diagnosis:    { classification, possible_causes, evidence, summary },
  proposed_fix: { pattern, journal_entry } | null,
  audit_metadata: { reason, detected_delta, before_balance, after_balance, confidence_level, approval_required },
  verification_plan: { reconciliation_to_re_run, expected_delta: 0, expected_status: "OK" }
}
```

Use `produceLedgerCorrectionProposal(result)` to obtain this format.

## Forbidden

- No SQL, no mutations, no execution steps
- No "auto-fix applied", no assumptions without evidence
- Editing `invoices`, `payments`, `credit_notes`
- Editing or deleting `journal_entries` / `journal_entry_lines`
- Rewriting history

Posting the proposed JE is a separate, approval-gated step. This module only produces the report and proposed structure; it does not post.
