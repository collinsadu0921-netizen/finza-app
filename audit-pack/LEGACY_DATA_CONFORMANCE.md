# Legacy Data Conformance Statement

**Document Version:** 1.0  
**Date:** 2025-01-17  
**Classification:** Auditor-facing data conformance documentation  
**Audience:** External accountants, auditors, compliance reviewers

---

## EXECUTIVE SUMMARY

This document describes the Phase 12 backfill approach that brings historical (pre-invariant) data into compliance with the current accounting model. All backfill operations are explicit, audited, and reversible. No silent data fixes are performed.

**Backfill Principles:**
- **Explicit only:** Backfill operations are explicitly invoked (not automatic)
- **Audited:** All backfill actions are logged to `backfill_audit_log` table
- **Reversible:** Backfilled entries are marked with `entry_type = 'backfill'` and can be identified
- **Period-aware:** Backfill only operates on `'open'` periods (no backfill into locked periods)

---

## PHASE 12 BACKFILL APPROACH

### Objective
Bring historical data (created before accounting invariant enforcement date) into compliance with current accounting invariants, specifically:

1. **Sales without journal entries:** Create journal entries for legacy sales missing ledger postings
2. **Invoices without journal entries:** Create journal entries for legacy invoices missing ledger postings
3. **Expenses without journal entries:** Create journal entries for legacy expenses missing ledger postings
4. **Payments without journal entries:** Create journal entries for legacy payments missing ledger postings

### Backfill Scope

**Date Cutoff:** `invariant_enforcement_date` (default: `'2024-01-01'`)  
**Legacy Detection:** Only records created before `invariant_enforcement_date` are considered for backfill  
**Period Status:** Backfill only operates on `'open'` periods (no backfill into `'soft_closed'` or `'locked'` periods)

### Backfill Functions

**1. `backfill_missing_sale_journals(p_business_id UUID, p_period_id UUID, p_invariant_enforcement_date DATE, p_actor TEXT)`**
- **Purpose:** Backfill missing journal entries for legacy sales
- **Location:** Migration 171_phase12_backfill_legacy_data.sql
- **Process:**
  1. Find sales in period where `sale.created_at::DATE < invariant_enforcement_date` and `journal_entry` does not exist
  2. Call `post_sale_to_ledger(sale_id, 'backfill', 'Phase 12 backfill: sale missing journal entry', actor)`
  3. Log action to `backfill_audit_log` table
- **Returns:** JSONB with `repaired` count (number of sales backfilled)

**2. `backfill_missing_invoice_journals(p_business_id UUID, p_period_id UUID, p_invariant_enforcement_date DATE, p_actor TEXT)`**
- **Purpose:** Backfill missing journal entries for legacy invoices
- **Location:** Migration 172_phase12b_backfill_completion_compatibility.sql
- **Process:**
  1. Find invoices in period where `invoice.issue_date < invariant_enforcement_date` and `status IN ('sent', 'paid', 'partially_paid')` and `journal_entry` does not exist
  2. Call `post_invoice_to_ledger(invoice_id, 'backfill', 'Phase 12B backfill: invoice missing journal entry', actor)`
  3. Log action to `backfill_audit_log` table
- **Returns:** JSONB with `repaired` count (number of invoices backfilled)

**3. `backfill_missing_expense_journals(p_business_id UUID, p_period_id UUID, p_invariant_enforcement_date DATE, p_actor TEXT)`**
- **Purpose:** Backfill missing journal entries for legacy expenses
- **Location:** Migration 172_phase12b_backfill_completion_compatibility.sql
- **Process:**
  1. Find expenses in period where `expense.date < invariant_enforcement_date` and `deleted_at IS NULL` and `journal_entry` does not exist
  2. Call `post_expense_to_ledger(expense_id, 'backfill', 'Phase 12B backfill: expense missing journal entry', actor)`
  3. Log action to `backfill_audit_log` table
- **Returns:** JSONB with `repaired` count (number of expenses backfilled)

**4. `backfill_missing_payment_journals(p_business_id UUID, p_period_id UUID, p_invariant_enforcement_date DATE, p_actor TEXT)`**
- **Purpose:** Backfill missing journal entries for legacy payments
- **Location:** Migration 172_phase12b_backfill_completion_compatibility.sql
- **Process:**
  1. Find payments in period where `payment.date < invariant_enforcement_date` and `deleted_at IS NULL` and `journal_entry` does not exist
  2. Call `post_invoice_payment_to_ledger(payment_id, 'backfill', 'Phase 12B backfill: payment missing journal entry', actor)`
  3. Log action to `backfill_audit_log` table
- **Returns:** JSONB with `repaired` count (number of payments backfilled)

### Backfill Metadata

**Journal Entry Metadata (for backfilled entries):**
- `entry_type = 'backfill'` (identifies backfilled entries)
- `backfill_reason` (TEXT, e.g., "Phase 12 backfill: sale missing journal entry")
- `backfill_at` (TIMESTAMP, when backfill was performed)
- `backfill_actor` (TEXT, who performed backfill, e.g., "system" or user UUID)

**Audit Log Table (`backfill_audit_log`):**
- `period_id` (UUID, period in which backfill occurred)
- `entity_type` (TEXT, e.g., 'sale', 'invoice', 'expense', 'payment')
- `entity_id` (UUID, ID of backfilled entity)
- `action_taken` (TEXT, e.g., 'created_journal_entry', 'backfill_failed')
- `actor` (TEXT, who performed backfill)
- `before_summary` (JSONB, state before backfill, e.g., `{"sale_id": "...", "had_journal_entry": false}`)
- `after_summary` (JSONB, state after backfill, e.g., `{"journal_entry_id": "...", "sale_id": "..."}`)
- `created_at` (TIMESTAMP, when backfill occurred)

---

## AUTO-REPAIRED ITEMS

### Items Automatically Repaired

**Sales:** Journal entries created for legacy sales missing ledger postings
- **Detection:** `detect_legacy_issues()` function identifies sales without journal entries
- **Repair:** `backfill_missing_sale_journals()` creates journal entries for missing sales
- **Marking:** Backfilled entries marked with `entry_type = 'backfill'`

**Invoices:** Journal entries created for legacy invoices missing ledger postings
- **Detection:** `detect_legacy_issues()` function identifies invoices without journal entries
- **Repair:** `backfill_missing_invoice_journals()` creates journal entries for missing invoices
- **Marking:** Backfilled entries marked with `entry_type = 'backfill'`

**Expenses:** Journal entries created for legacy expenses missing ledger postings
- **Detection:** `detect_legacy_issues()` function identifies expenses without journal entries
- **Repair:** `backfill_missing_expense_journals()` creates journal entries for missing expenses
- **Marking:** Backfilled entries marked with `entry_type = 'backfill'`

**Payments:** Journal entries created for legacy payments missing ledger postings
- **Detection:** `detect_legacy_issues()` function identifies payments without journal entries
- **Repair:** `backfill_missing_payment_journals()` creates journal entries for missing payments
- **Marking:** Backfilled entries marked with `entry_type = 'backfill'`

**Note:** All backfill operations are explicit (not automatic). Backfill functions must be explicitly invoked. No silent data fixes are performed.

---

## ITEMS FLAGGED FOR MANUAL REVIEW

### Items Requiring Manual Review

**Sales with Incomplete Ledger Lines:** Sales with journal entries but missing required ledger lines
- **Detection:** `detect_legacy_issues()` function identifies sales missing required accounts (Cash/AR, Revenue, COGS if inventory, Inventory if inventory)
- **Reason:** Requires investigation to determine correct posting logic (may be data issue or posting function bug)
- **Action:** Manual review required to determine if correction is needed

**Trial Balance Imbalances:** Periods where Trial Balance does not balance (debits ≠ credits)
- **Detection:** `detect_legacy_issues()` function identifies periods where `trial_balance_snapshots.is_balanced = FALSE`
- **Reason:** Imbalance indicates missing or incorrect journal entries (requires manual correction)
- **Action:** Manual review required to identify root cause and create adjustment entries

**Periods Not Properly Closed:** Legacy periods with status other than `'soft_closed'` or `'locked'`
- **Detection:** `detect_legacy_issues()` function identifies periods where `status NOT IN ('soft_closed', 'locked')` and `period_start < invariant_enforcement_date`
- **Reason:** Legacy periods should be closed/locked (requires manual period close/lock action)
- **Action:** Manual review required to determine if period should be soft-closed or locked

**Periods Without Opening Balances:** Legacy periods missing opening balance records
- **Detection:** `detect_legacy_issues()` function identifies periods where `period_opening_balances` records do not exist
- **Reason:** Opening balances may not have been generated (requires manual generation via `generate_opening_balances()`)
- **Action:** Manual review required to determine if opening balances should be generated (depends on period status and prior period state)

---

## CONFORMANCE COUNTS (SAMPLE)

**Note:** Actual counts are dynamic and depend on business data. Sample counts are provided for reference.

### Auto-Repaired Items (Sample Counts)

| Entity Type | Backfilled Count | Period ID | Actor | Status |
|------------|------------------|-----------|-------|--------|
| Sales | 15 | Period 2024-01 | system | ✅ Completed |
| Invoices | 8 | Period 2024-01 | system | ✅ Completed |
| Expenses | 3 | Period 2024-01 | system | ✅ Completed |
| Payments | 12 | Period 2024-01 | system | ✅ Completed |

**Total Auto-Repaired:** 38 entries (across all backfilled periods)

### Flagged for Manual Review (Sample Counts)

| Issue Type | Count | Period ID | Status |
|-----------|-------|-----------|--------|
| Sales with incomplete ledger lines | 2 | Period 2024-01 | ⚠️ Requires review |
| Trial Balance imbalances | 0 | N/A | ✅ None detected |
| Periods not properly closed | 5 | Periods 2023-10 to 2024-03 | ⚠️ Requires review |
| Periods without opening balances | 3 | Periods 2024-01 to 2024-03 | ⚠️ Requires review |

**Total Flagged for Review:** 10 items (across all legacy periods)

---

## BACKFILL VERIFICATION

### Verification Queries

**1. Count backfilled entries:**
```sql
SELECT 
  entry_type,
  reference_type,
  COUNT(*) as count
FROM journal_entries
WHERE entry_type = 'backfill'
GROUP BY entry_type, reference_type;
```

**2. Review backfill audit log:**
```sql
SELECT 
  entity_type,
  action_taken,
  actor,
  created_at,
  COUNT(*) as count
FROM backfill_audit_log
GROUP BY entity_type, action_taken, actor, created_at
ORDER BY created_at DESC;
```

**3. Identify backfilled entries by period:**
```sql
SELECT 
  ap.period_start,
  je.reference_type,
  COUNT(*) as backfilled_count
FROM journal_entries je
JOIN accounting_periods ap ON je.date >= ap.period_start AND je.date <= ap.period_end
WHERE je.entry_type = 'backfill'
GROUP BY ap.period_start, je.reference_type
ORDER BY ap.period_start DESC;
```

---

## LEGACY DETECTION FUNCTION

### Detection Function
**Function:** `detect_legacy_issues(p_business_id UUID, p_invariant_enforcement_date DATE)`

**Location:** Migration 172_phase12b_backfill_completion_compatibility.sql

**Purpose:** Identifies legacy (pre-invariant) records that fail current invariants (read-only, no side effects)

**Returns:** JSONB with:
- `sales_without_journal_entry` (array of sale IDs)
- `invoices_without_journal_entry` (array of invoice IDs)
- `expenses_without_journal_entry` (array of expense IDs)
- `payments_without_journal_entry` (array of payment IDs)
- `journal_entries_missing_required_lines` (array of journal entry IDs with missing lines)
- `sale_jes_missing_cash_or_ar` (array of sale journal entries missing Cash/AR)
- `sale_jes_missing_revenue` (array of sale journal entries missing Revenue)
- `sale_jes_missing_cogs` (array of sale journal entries missing COGS for inventory sales)
- `sale_jes_missing_inventory` (array of sale journal entries missing Inventory for inventory sales)
- `sale_jes_missing_tax` (array of sale journal entries missing Tax for taxed sales)
- `periods_without_opening_balances` (array of period IDs)
- `periods_not_properly_closed` (array of period IDs)
- `trial_balance_imbalance` (array of period IDs with imbalances)
- `counts` (object with count for each category)

**Usage:** Execute `SELECT detect_legacy_issues('<business_id>', '2024-01-01')` to identify legacy issues for manual review or backfill.

---

## MIGRATION REFERENCES

- **Migration 171:** `171_phase12_backfill_legacy_data.sql` - Sales backfill
- **Migration 172:** `172_phase12b_backfill_completion_compatibility.sql` - Invoices, expenses, payments backfill

---

**END OF DOCUMENT**
