# Reversal Workflow Specification

Standardized framework for reversing posted journal entries. Ledger remains immutable; reversals are new journal entries that mirror the original with debits and credits swapped.

---

## 1. Requirements

1. **Accountants may reverse any posted journal entry** subject to period and approval rules.
2. **Reversal mechanics:**
   - Create a **new** journal entry (no edit/delete of original).
   - Mirror original lines with **debit/credit swapped**.
   - **Reference the original JE** (e.g. `adjustment_ref` or reversal link).
   - Require **open period** for the reversal date.
   - Preserve **audit chain** (original → reversal).
3. **Reversal metadata** must include:
   - `reversed_journal_entry_id` — original JE id.
   - `reversal_reason` — mandatory text (e.g. "Duplicate posting", "Wrong period").
   - `reversed_by` — user/id performing the reversal.
   - `reversal_date` — date of the reversal action.

---

## 2. Workflow Specification

### 2.1 Preconditions

- User has **accountant** (or equivalent) authority for the business.
- **Accounting period** for the reversal date is **open** (not closed/hard closed).
- Original journal entry exists and is **posted** (not draft).
- Business is **not archived** (or reactivation procedure followed if allowed).

### 2.2 Steps

1. **Select** the journal entry to reverse (from Ledger / General Ledger / report).
2. **Confirm** reversal intent (warning: "This will create a reversing entry. Original entry will not be modified.").
3. **Enter** reversal reason (required); optional reversal date (default: today).
4. **System** derives reversal lines: same accounts, amounts; swap debit ↔ credit.
5. **System** posts new JE with:
   - `reference_type` = `adjustment` (or designated reversal type per contract).
   - `reference_id` = null or link to original as per contract.
   - `adjustment_ref` / reversal metadata = original JE id + reason + actor + date.
6. **Audit log** records: action = reversal, original_je_id, reversal_je_id, reason, user, timestamp.

### 2.3 Postconditions

- Original JE unchanged.
- One new JE created; total debits = total credits; period assigned; balance checks pass.
- Audit trail links original → reversal.

---

## 3. UI Flow Design

| Step | Screen / Component | Behaviour |
|------|--------------------|-----------|
| 1 | Ledger / JE list | "Reverse" action on a posted JE (disabled for draft or closed period). |
| 2 | Reversal confirmation modal | Warning text; required "Reversal reason" field; optional date. |
| 3 | Submit | Call reversal API; on success show new JE id and link to view. |
| 4 | Audit | Reversal appears in audit log and (if implemented) in "Reversals" or "Adjustments" view. |

---

## 4. Reversal Audit Trail Structure

Recommended fields to capture (in audit log and/or reversal metadata):

| Field | Required | Description |
|-------|----------|-------------|
| `reversed_journal_entry_id` | Yes | UUID of original JE. |
| `reversal_journal_entry_id` | Yes | UUID of new reversing JE. |
| `reversal_reason` | Yes | Free text; stored with reversal JE (e.g. adjustment_reason). |
| `reversed_by` | Yes | User id (and optionally name) performing reversal. |
| `reversal_date` | Yes | Date of reversal (and timestamp for audit log). |
| `business_id` | Yes | Tenant scope. |
| `period_id` | Yes | Period in which reversal is posted. |

---

## 5. Reversal Approval Rules

- **Default:** Single accountant with write authority may reverse (subject to open period).
- **Optional policy:** Reversals above a **threshold** (e.g. amount or materiality) require **second approval** or **owner** sign-off (configured per business/firm).
- **Period closed:** No reversal in closed period unless **reopen** is performed first (see [ACCOUNTING_PERIOD_OPERATIONS_SOP.md](./ACCOUNTING_PERIOD_OPERATIONS_SOP.md)); reopen may require partner/owner approval.
- **Documentation:** Reversal reason is mandatory; retention aligned with [ACCOUNTING_AUDIT_STANDARD.md](./ACCOUNTING_AUDIT_STANDARD.md).

---

## 6. Integration with Existing Contract

- Reversals are implemented as **adjustment**-type journal entries (or equivalent) per existing posting contract.
- Use existing `post_journal_entry` (or designated reversal path) with:
  - `is_adjustment` and `adjustment_reason` / `adjustment_ref` as per contract.
  - Lines = swapped debits/credits of original JE.
- No change to ledger schema or posting engine; only operational use of existing capabilities.
