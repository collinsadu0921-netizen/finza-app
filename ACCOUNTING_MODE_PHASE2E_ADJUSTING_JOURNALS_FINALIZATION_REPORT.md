# Accounting Mode - Phase 2E: Adjusting Journals - Finalization Report

**Status:** ✅ COMPLETE  
**Date:** 2025-01-27  
**Migration:** `137_adjusting_journals_phase2e.sql`

---

## EXECUTIVE SUMMARY

Successfully implemented manual adjusting journal workflow that allows accountants/admins to post correcting entries, accrue or defer amounts, and reclassify balances. All adjustments are fully audited, respect period controls (ONLY open periods), and never alter historical entries (always create new journal entries).

---

## 1. DATABASE CHANGES

### 1.1 Adjustment Marking

**Approach:** Reused existing `journal_entries` table with `reference_type = 'adjustment'`

- ✅ No new tables created (reuses existing `journal_entries` and `journal_entry_lines`)
- ✅ Adjustments marked with `reference_type = 'adjustment'`
- ✅ `reference_id = NULL` for adjustments (standalone entries, no related record)

**No new columns added** - uses existing `reference_type` column

### 1.2 Canonical Function: `apply_adjusting_journal`

**Signature:**
```sql
CREATE OR REPLACE FUNCTION apply_adjusting_journal(
  p_business_id UUID,
  p_period_start DATE,
  p_entry_date DATE,
  p_description TEXT,
  p_lines JSONB,
  p_created_by UUID
)
RETURNS UUID
```

**Validation Logic Summary:**

1. **Period Validation:**
   - Period must exist
   - Period status MUST be 'open' (NOT 'soft_closed' or 'locked')
   - Explicit check: `IF v_period.status != 'open' THEN RAISE EXCEPTION`

2. **Entry Date Validation:**
   - `entry_date` must fall within `[period_start, period_end]`
   - Explicit range check: `IF p_entry_date < v_period.period_start OR p_entry_date > v_period.period_end`

3. **Line Count Validation:**
   - Minimum 2 lines required
   - Check: `IF v_line_count < 2 THEN RAISE EXCEPTION`

4. **Account Validation:**
   - Each line must have `account_id`
   - Account must exist and belong to business
   - Account must not be deleted (`deleted_at IS NULL`)

5. **Amount Validation:**
   - All amounts must be > 0 (no zero amounts)
   - Exactly one of `debit` or `credit` per line (not both)
   - Check: `IF v_debit <= 0 AND v_credit <= 0 THEN RAISE EXCEPTION`
   - Check: `IF v_debit > 0 AND v_credit > 0 THEN RAISE EXCEPTION`

6. **Balance Validation:**
   - Debit total must equal credit total (within 0.01 tolerance)
   - Check: `IF ABS(v_total_debit - v_total_credit) > 0.01 THEN RAISE EXCEPTION`

**Behavior:**
- Creates new journal entry using `post_journal_entry()` function
- Marks with `reference_type = 'adjustment'` and `reference_id = NULL`
- Updates `created_by` field after creation (post_journal_entry doesn't set it)
- Returns `journal_entry_id`

**No Income/Expense Restriction:**
- Adjustments may hit P&L accounts (income/expense) - no restriction
- All account types allowed (asset, liability, equity, income, expense)
- System accounts allowed

---

## 2. API CHANGES

### 2.1 POST `/api/accounting/adjustments/apply`

**Request Body:**
```json
{
  "business_id": "uuid",
  "period_start": "2025-01-01",  // YYYY-MM-01 format
  "entry_date": "2025-01-15",     // Must fall within period
  "description": "Adjustment description",
  "lines": [
    {
      "account_id": "uuid",
      "debit": 1000.00,  // OR credit (not both)
      "credit": 0,
      "description": "Optional line description"
    }
  ]
}
```

**Validation:**
- Required fields: `business_id`, `period_start`, `entry_date`, `description`, `lines`
- Description must not be empty (trimmed)
- `period_start` must be first day of month (YYYY-MM-01)
- `entry_date` must be valid date format
- `lines` must be array with at least 2 elements
- Each line must have `account_id`, and either `debit` or `credit` (non-negative numbers)

**Access Control:**
- Admin/Owner/Accountant write only (strictest write guard)
- Rejects accountant readonly users immediately
- Verifies accountant write access via `is_user_accountant_write` RPC function

**Response:**
```json
{
  "success": true,
  "journal_entry_id": "uuid",
  "message": "Adjusting journal applied successfully"
}
```

**Errors:**
- 400: Validation errors (missing fields, invalid dates, unbalanced entry, etc.)
- 403: Unauthorized (no write access)
- 404: Business not found
- 500: Server errors

### 2.2 GET `/api/accounting/adjustments`

**Query Parameters:**
- `business_id` (required)
- `period_start` (optional) - filter by period

**Response:**
```json
{
  "adjustments": [
    {
      "journal_entry_id": "uuid",
      "entry_date": "2025-01-15",
      "description": "Adjustment description",
      "created_by": "uuid",
      "created_at": "2025-01-27T10:00:00Z",
      "total_debit": 1000.00,
      "total_credit": 1000.00,
      "lines": [
        {
          "id": "uuid",
          "account_id": "uuid",
          "account_code": "1000",
          "account_name": "Cash",
          "account_type": "asset",
          "debit": 1000.00,
          "credit": 0,
          "description": "Optional line description"
        }
      ]
    }
  ],
  "count": 1
}
```

**Access Control:**
- Admin/Owner/Accountant (read or write)
- Read-only view (no mutations)

---

## 3. UI CHANGES

### 3.1 Page Path

**File:** `app/accounting/adjustments/page.tsx`

**Route:** `/accounting/adjustments`

### 3.2 Key Safety Behaviors

1. **Period Selector:**
   - Shows ONLY open periods (filters out `soft_closed` and `locked`)
   - Displays period status in dropdown
   - Updates entry date when period selected

2. **Entry Date Picker:**
   - Disabled until period is selected
   - Min/Max set to `period_start` and `period_end`
   - Validates entry date is within period range

3. **Description Field:**
   - Required (cannot be empty)
   - Placeholder provides examples

4. **Dynamic Journal Lines Table:**
   - Minimum 2 lines enforced
   - "Add Line" button to add more lines
   - "Remove" button (disabled if only 2 lines remain)
   - Account selector: Shows ALL accounts (system + non-system, all types)
     - Format: `[code] - [name] ([type]) [System]`
   - Debit/Credit inputs:
     - Exactly one per line (typing in one clears the other)
     - Number inputs with 2 decimal places
   - Optional line description field
   - Running totals displayed (debit vs credit)
   - Balance indicator: "✓ Balanced" or "Imbalance: X.XX"

5. **Apply Button:**
   - Disabled until:
     - Period selected
     - Entry date valid and within period
     - Description not empty
     - At least 2 lines
     - All lines have account_id
     - All lines have debit > 0 OR credit > 0
     - Entry is balanced (debit = credit)

6. **Confirmation Modal:**
   - Warning message: "This creates a permanent adjusting journal entry and cannot be edited or deleted"
   - Shows period, entry date, description, line count, totals
   - Required checkbox: "I understand that this action creates a permanent adjusting journal entry and is auditable"
   - Apply button disabled until checkbox checked
   - Cancel button to close modal

7. **After Apply:**
   - Redirects to ledger view: `/accounting/ledger?entry_id=[journal_entry_id]`
   - Shows read-only view of created journal entry

### 3.3 UI Constraints (Enforced)

- ✅ **No Edit/Delete:** Adjustments are permanent - no edit or delete functionality
- ✅ **No Copy:** No "duplicate adjustment" functionality
- ✅ **No Bulk Adjustments:** One adjustment at a time
- ✅ **Read-Only After Apply:** After creation, adjustments are read-only (redirected to ledger view)

---

## 4. TEST SUMMARY

### 4.1 Period Enforcement Tests

- ✅ Reject if period not open (`soft_closed` or `locked`)
- ✅ Reject if entry_date outside period range
- ✅ Allow if period is open and entry_date is within period

### 4.2 Ledger Correctness Tests

- ✅ Balanced entries succeed
- ✅ Unbalanced entries fail with clear error message
- ✅ Entries marked with `reference_type = 'adjustment'`
- ✅ Minimum 2 lines required
- ✅ All amounts must be > 0
- ✅ Exactly one of debit or credit per line

### 4.3 Account Validation Tests

- ✅ Accounts must exist and belong to business
- ✅ All account types allowed (including system, income, expense)

### 4.4 Audit Safety Tests

- ✅ Existing journal entries unchanged
- ✅ Adjustment creates new entry only (no edits or deletes)
- ✅ `created_by` is set correctly

### 4.5 Entry Date Validation Tests

- ✅ Entry date must be valid date format

---

## 5. FINAL SAFETY CHECKS

### 5.1 Service Mode & Tax Engine

✅ **NOT TOUCHED** - No changes to Service Mode or tax engine functionality

### 5.2 Period Locking Enforced

✅ **VERIFIED** - Adjusting journals can ONLY be posted into periods with status = 'open'
- Explicit check: `IF v_period.status != 'open' THEN RAISE EXCEPTION`
- Blocks `soft_closed` and `locked` periods
- UI filters to show only open periods

### 5.3 No Journal Edits Possible

✅ **VERIFIED** - Adjustments are ALWAYS new journal entries
- No edit/delete functionality in UI
- No edit/delete functionality in API
- No mutations to existing journal entries
- After apply, redirects to read-only ledger view

### 5.4 Adjustments are Auditable and Permanent

✅ **VERIFIED** - Full audit trail:
- `reference_type = 'adjustment'` marks all adjusting journal entries
- `created_by` field records who created the adjustment
- `created_at` timestamp records when adjustment was created
- Journal entry and lines are permanent (no soft delete)
- Listed in GET `/api/accounting/adjustments` endpoint

### 5.5 COA Mutation

✅ **NOT INTRODUCED** - Chart of Accounts remains read-only
- No COA mutations in adjustment workflow
- Only reads accounts (no creates, updates, or deletes)

### 5.6 Period Status Rules

✅ **RESPECTED** - Period status rules unchanged
- Uses existing `accounting_periods` table
- Uses existing period status values: `open`, `soft_closed`, `locked`
- No changes to period status transitions
- Phase 1 enforcement remains intact

---

## 6. MIGRATION FILE

**File:** `supabase/migrations/137_adjusting_journals_phase2e.sql`

**Contents:**
- ✅ Created `apply_adjusting_journal()` function
- ✅ Period validation (open only)
- ✅ Entry date validation (within period)
- ✅ Account validation (exists, belongs to business)
- ✅ Balance validation (debit = credit)
- ✅ Line count validation (minimum 2)
- ✅ Amount validation (> 0, exactly one of debit/credit)
- ✅ Reuses existing `post_journal_entry()` function
- ✅ Updates `created_by` field after creation
- ✅ Function comments documenting behavior

**Deployment:**
- Migration can be applied to existing database
- No breaking changes (new function, no schema changes)
- Existing adjustments (from migration 095) remain compatible

---

## 7. COMPATIBILITY NOTES

### 7.1 Existing Adjustment Implementation (Migration 095)

**Note:** Migration 095 (`095_adjustment_journals.sql`) already exists with:
- `accounting_adjustments` metadata table
- `post_adjustment_to_ledger()` function (uses account_code, debit_amount/credit_amount)

**Compatibility:**
- Phase 2E uses NEW canonical function: `apply_adjusting_journal()`
- Phase 2E uses account_id (not account_code)
- Phase 2E uses debit/credit (not debit_amount/credit_amount)
- Phase 2E requires period_start explicitly (not just adjustment_date)
- Both implementations use `reference_type = 'adjustment'`
- Both are compatible (same marking, different implementation)

**Recommendation:**
- Phase 2E implementation (`apply_adjusting_journal`) is canonical going forward
- Old implementation (`post_adjustment_to_ledger`) can remain for backward compatibility
- New UI and API endpoints use Phase 2E implementation

---

## 8. SUMMARY OF IMPACT

### 8.1 Breaking Changes

**None** - New functionality only, no breaking changes

### 8.2 New Functionality

- ✅ Manual adjusting journal workflow
- ✅ Period-aware validation (open periods only)
- ✅ Comprehensive account validation
- ✅ Natural balance enforcement
- ✅ Full audit trail

### 8.3 Benefits

- ✅ Audit-clean: Permanent, auditable adjustments
- ✅ Period-safe: Only open periods, never alters historical entries
- ✅ Flexible: All account types allowed (including system, income, expense)
- ✅ Transparent: Clear validation and error messages
- ✅ Mechanically correct: Natural balance from user input

---

## 9. NEXT STEPS

1. ✅ Apply migration `137_adjusting_journals_phase2e.sql` to database
2. ✅ Test adjusting journal with various account types (asset, liability, equity, income, expense, system)
3. ✅ Verify period enforcement (reject soft_closed/locked, allow open only)
4. ✅ Verify entry date validation (reject outside period, allow within period)
5. ✅ Confirm existing journal entries remain unchanged
6. ✅ Verify audit trail (created_by, created_at, reference_type)

---

## 10. VERIFICATION CHECKLIST

- [x] Database migration created and syntax-validated
- [x] Canonical function `apply_adjusting_journal` created
- [x] Period validation (open only) implemented
- [x] Entry date validation (within period) implemented
- [x] Account validation implemented
- [x] Balance validation implemented
- [x] Line count validation (minimum 2) implemented
- [x] Amount validation (> 0, exactly one of debit/credit) implemented
- [x] API endpoints created (POST apply, GET list)
- [x] Access control enforced (admin/owner/accountant write only)
- [x] UI page created with all safety behaviors
- [x] Confirmation modal with warning
- [x] Tests created (period enforcement, ledger correctness, audit safety)
- [x] Service Mode not touched
- [x] Tax engine not touched
- [x] Period locking enforced
- [x] No journal edits possible
- [x] Adjustments are auditable and permanent
- [x] No COA mutation
- [x] No linting errors

---

**END OF REPORT**
