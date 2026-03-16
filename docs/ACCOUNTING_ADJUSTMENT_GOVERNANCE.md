# Adjustment Entry Governance

When to use **reversals**, **adjustment journals**, or **new manual entries**; approval thresholds; and accountant authority model.

---

## 1. Decision Matrix

| Situation | Use | Rationale |
|-----------|-----|-----------|
| Posted entry was wrong (duplicate, wrong amount, wrong account) | **Reversal** | Cancel effect of original with a reversing entry; audit trail preserved. |
| Correct an imbalance or reclassification without cancelling an existing JE | **Adjustment journal** | New entry that fixes balances; reference reason and (if applicable) source document. |
| New event (e.g. depreciation, accrual, manual invoice) | **New entry** (manual/journal) | Not a correction; new transaction. |
| Reconciliation fix (AR/ledger mismatch) | **Reconciliation resolve** (existing flow) | Use approved reconciliation workflow; do not bypass with ad-hoc adjustment. |
| Period already closed | **Reopen** (per SOP) then **reversal or adjustment** in reopened period | No posting into closed period without formal reopen. |

---

## 2. When to Reverse

- Duplicate posting (same transaction posted twice).
- Wrong amount or wrong account on a single JE that must be fully undone.
- Posting in wrong period (reverse in wrong period, then post correctly in correct period if allowed).
- Reversals must reference original JE and require mandatory reason.

---

## 3. When to Adjust (Adjustment Journal)

- Reclassification (move amount from one account to another).
- Correction that does not require "cancelling" a prior JE (e.g. missed accrual, allocation).
- Adjustments require `adjustment_reason` and (per contract) may require `reference_id` for revenue corrections.
- Use adjustment entry type; do not use for simple reversals.

---

## 4. When to Create New Entry (Manual / Journal)

- New business event: depreciation, prepayment, manual invoice, manual payment.
- Not a correction of an existing JE; new transaction with full description and supporting docs.

---

## 5. Approval Thresholds

| Threshold type | Example rule | Authority |
|----------------|--------------|-----------|
| **Small reversal/adjustment** | Amount ≤ X (e.g. materiality) or within policy | Single accountant with write. |
| **Large reversal/adjustment** | Amount > X or high-risk account | Second approval or owner (per ledger adjustment policy). |
| **Period reopen** | Any | Per [ACCOUNTING_PERIOD_OPERATIONS_SOP.md](./ACCOUNTING_PERIOD_OPERATIONS_SOP.md); typically owner/partner. |
| **Reconciliation resolve** | Per existing policy (small delta vs owner/two-person) | Already defined in reconciliation governance. |

---

## 6. Accountant Authority Model

- **Read:** View ledger, reports, periods, forensic results (per RLS).
- **Write (post):** Post manual journals, adjustments, reversals in **open** periods; subject to approval thresholds.
- **Approve:** Where two-person or owner approval is required, only designated roles can approve.
- **Period close / reopen:** Restricted to owner or partner (per period SOP).
- **Monitoring override:** No override of forensic logic; only operational response (investigate, correct, document).

---

## 7. Risk Classification

| Risk level | Examples | Control |
|------------|----------|---------|
| **Low** | Small adjustment, clear reason, open period | Single accountant; mandatory reason. |
| **Medium** | Larger amount, reclassification, reversal | Optional second approval per policy. |
| **High** | Period reopen, revenue correction, bulk correction | Owner/partner approval; full documentation. |
| **Critical** | Any change affecting closed period or forensic state | Formal reopen + approval + audit trail. |

---

## 8. References

- Reversal workflow: [ACCOUNTING_REVERSAL_WORKFLOW.md](./ACCOUNTING_REVERSAL_WORKFLOW.md)
- Period operations: [ACCOUNTING_PERIOD_OPERATIONS_SOP.md](./ACCOUNTING_PERIOD_OPERATIONS_SOP.md)
- Audit standard: [ACCOUNTING_AUDIT_STANDARD.md](./ACCOUNTING_AUDIT_STANDARD.md)
- Existing ledger adjustment policy (DB): `ledger_adjustment_policy`, reconciliation approval flows.
