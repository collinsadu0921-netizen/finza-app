# Accountant UI Guardrails

Behavioural safeguards in the UI: warnings, required justifications, approval gating, lock indicators, and audit visibility. **No change** to ledger or posting engine; design only (implementation follows product roadmap).

---

## 1. Warning Prompts Before Risky Actions

| Action | When to show | Message type |
|--------|----------------|--------------|
| **Reverse JE** | User clicks "Reverse" on a posted JE | Warning: "This will create a reversing entry. The original entry will not be modified. You must provide a reversal reason." |
| **Post adjustment** | User posts an adjustment-type JE | Warning: "You are posting an adjustment. Ensure reason and reference are correct." |
| **Close period** | User initiates period close | Warning: "Closing this period will prevent further posting. Ensure all reconciliations and reviews are complete." |
| **Reopen period** | User requests reopen | Warning: "Reopening allows new posting in a closed period. This action requires approval and must be documented." |
| **Approve (two-person)** | Second approver submits | Confirm: "You are approving this adjustment. It will be posted immediately upon submit." |

---

## 2. Required Justification Fields

| Screen / flow | Required field | Validation |
|----------------|----------------|------------|
| Reversal | Reversal reason (text) | Non-empty; min length per policy (e.g. 10 chars). |
| Adjustment journal | Adjustment reason | Non-empty (per posting contract). |
| Period reopen request | Reason for reopen | Non-empty; stored with approval. |
| Forensic resolution sign-off | Resolution notes | Non-empty before marking resolved. |

---

## 3. Approval Gating

- **Reversal / adjustment above threshold:** Show "Pending approval" until second approver or owner approves; hide "Post" or show "Request approval" for submitter.
- **Period close:** Only show "Close period" to roles with close authority (e.g. owner/partner).
- **Period reopen:** Show "Request reopen" to accountant; "Approve reopen" only to owner/partner; actual reopen after approval.
- **Reconciliation resolve (large delta):** Per existing flow; owner or second approver required before post.

---

## 4. Lock Indicators

- **Period closed:** Badge or label "Closed" on period; disable "Post", "Reverse", "Adjust" for that period (or show "Reopen required").
- **Period soft closed:** Badge "Soft closed"; only designated roles can post; show who can post.
- **JE locked:** If a JE is referenced by a reversal or cannot be edited (immutability), show "Locked" or "Reversed by &lt;id&gt;" so users do not attempt edit.
- **Forensic run in progress:** Optional indicator when nightly run is executing (read-only; no override).

---

## 5. Audit Visibility Surfaces

- **Ledger / JE list:** Optional column or tooltip "Reversed by", "Reversal of &lt;id&gt;" for reversal chain.
- **Audit log / activity:** Dedicated view or filter for accounting actions: reversals, adjustments, period close/reopen, approvals, forensic resolutions.
- **Per-JE audit:** Link from JE to "Audit trail" for that entry (who posted, when; if reversed, who reversed and why).
- **Forensic runs:** List runs with status, total_failures, link to failures; from failure detail, link to business and (if implemented) resolution form.

---

## 6. Implementation Notes

- All guardrails are **additive** (warnings, required fields, visibility); they do not alter posting contract or period logic.
- Role checks and approval gates should use existing authority model (e.g. accountant, owner, partner) and ledger adjustment policy where applicable.
