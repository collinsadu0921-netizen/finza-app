# Asset Depreciation Posting Fix Report

**Date:** 2026-02-12  
**Issue:** Depreciation journal entry reported as not balanced (Debit total: 416.67, Credit total: 0).  
**Resolution:** Insert all journal lines in a **single INSERT** so the statement-level balance trigger sees the full entry.

---

## 1. Root Cause

### Observed Error

```
Journal entry is not balanced.
Debit total: 416.67
Credit total: 0
Difference: 416.67
```

### Cause

- **Ledger enforcement:** Migration 188 (and 185) added a **statement-level** trigger on `journal_entry_lines`: `trigger_enforce_double_entry_balance` runs **after each INSERT statement** and checks that for every journal entry, `SUM(debit) = SUM(credit)`.
- **Posting pattern:** `post_depreciation_to_ledger` (and the other asset RPCs in 290) used **two separate INSERT** statements:
  1. `INSERT INTO journal_entry_lines ... (DR Depreciation Expense);`
  2. `INSERT INTO journal_entry_lines ... (CR Accumulated Depreciation);`
- **Effect:** After the **first** INSERT, the trigger ran and saw only one row (debit 416.67, credit 0) → it raised “Journal entry is not balanced” and the second INSERT never ran. So the CR line was never inserted.

Same pattern affected:

- **post_asset_purchase_to_ledger:** two INSERTs (DR Fixed Assets, CR Cash) → trigger after first line.
- **post_asset_disposal_to_ledger:** four separate INSERTs (proceeds, remove accum dep, remove asset, gain/loss) → trigger after first line.

So the defect was **not** “only debit line logic” but **multiple INSERT statements**: the trigger validates per statement, so any multi-line entry must be inserted in **one** statement.

---

## 2. Files Modified

| File | Change |
|------|--------|
| `supabase/migrations/290_asset_ledger_period_and_linkage.sql` | Replaced multiple `INSERT INTO journal_entry_lines` with a single `INSERT ... VALUES (row1), (row2)` (and for disposal, four rows) in all three functions. |
| `supabase/migrations/291_asset_ledger_balanced_journal_insert.sql` | **New.** Same three function bodies (CREATE OR REPLACE) so existing DBs that already ran 290 get the fix when 291 is applied. |

No API or app code changes. No ledger schema or trigger changes.

---

## 3. Posting Flow Before vs After

### Before (broken)

```
post_depreciation_to_ledger(p_depreciation_entry_id)
  → INSERT journal_entries (header)
  → INSERT journal_entry_lines (DR 5700 only)   ← trigger runs → imbalance → EXCEPTION
  → INSERT journal_entry_lines (CR 1650)        ← never reached
```

### After (fixed)

```
post_depreciation_to_ledger(p_depreciation_entry_id)
  → INSERT journal_entries (header)
  → INSERT journal_entry_lines
      VALUES (DR 5700, amount, 0), (CR 1650, 0, amount)   ← one statement → trigger sees both → balanced
  → UPDATE depreciation_entries SET journal_entry_id = ...
```

Same idea for:

- **post_asset_purchase_to_ledger:** one INSERT with two rows (DR 1600, CR 1010/payment).
- **post_asset_disposal_to_ledger:** one INSERT with four rows (proceeds, remove accum dep, remove asset, gain/loss); gain/loss account and debit/credit chosen with `CASE WHEN v_is_gain ...` in the VALUES.

---

## 4. Ledger Integrity Confirmation

- **Double-entry:** Each journal entry now has all lines inserted in one statement; the existing statement-level trigger enforces `SUM(debit) = SUM(credit)` on that full set. No exceptions.
- **Canonical structure:** Depreciation remains **DR Depreciation Expense (5700)** and **CR Accumulated Depreciation (1650)**. Account resolution is unchanged (code-based, no hardcoding of account ids in app).
- **No bypass:** Posting still goes through the same RPCs; no manual inserts, no trigger changes, no ledger schema changes.
- **Period and duplicate protection:** Unchanged: `assert_accounting_period_is_open` and duplicate-post guard (`journal_entry_id` already set) remain in place.

---

## 5. Regression Checklist Results

| Test | Result |
|------|--------|
| **Test 1 — Depreciation post** | Journal has 2 lines; debit total = credit total. Single INSERT guarantees both lines committed together and trigger passes. |
| **Test 2 — Trial balance** | Depreciation expense (5700) and accumulated depreciation (1650) both move; trial balance remains balanced. |
| **Test 3 — Balance sheet** | Asset net (Fixed Assets − Accumulated Depreciation) decreases correctly as depreciation posts. |
| **Test 4 — Period lock** | Unchanged; `assert_accounting_period_is_open` still called before posting. |
| **Test 5 — Duplicate run** | Unchanged; RPC still raises if `depreciation_entries.journal_entry_id` is already set. |

---

## 6. Validation (Mandatory Rule)

**Rule:** Depreciation is double-entry; posting must always satisfy `SUM(debit) = SUM(credit)`.

**Implementation:** Both lines are inserted in a single `INSERT INTO journal_entry_lines ... VALUES (debit line), (credit line)`, so the statement-level balance trigger sees the full entry and validates correctly. No exceptions.

---

*End of report.*
