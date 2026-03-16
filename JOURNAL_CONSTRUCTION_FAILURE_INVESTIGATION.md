# JOURNAL CONSTRUCTION FAILURE: INVESTIGATION REPORT

## Executive Summary
Retail sale posting fails with unbalanced journal entry: **Debit: 100, Credit: 0**. The journal_lines array passed to `post_journal_entry()` contains only debit entries. All credit lines (Revenue, Tax Payable, Inventory) are missing or have zero values.

---

## 1. Journal Lines Assembly Timeline

### Function: `post_sale_to_ledger()`
**File**: `supabase/migrations/179_retail_system_accountant_posting.sql`
**Starting Line**: 210

### Declaration
- **Line 240**: `journal_lines JSONB;` (DECLARE section)
- Initial value: NULL (uninitialized)

### Construction Order

#### Step 1: Initial Array Build (Lines 387-408)
```sql
journal_lines := jsonb_build_array(
  jsonb_build_object(
    'account_id', cash_account_id,        -- DEBIT: gross_total (100)
    'debit', gross_total,
    'description', 'Sale receipt'
  ),
  jsonb_build_object(
    'account_id', revenue_account_id,     -- CREDIT: net_total (expected ~83.34)
    'credit', net_total,
    'description', 'Sales revenue'
  ),
  jsonb_build_object(
    'account_id', cogs_account_id,        -- DEBIT: total_cogs (expected 0)
    'debit', total_cogs,
    'description', 'Cost of goods sold'
  ),
  jsonb_build_object(
    'account_id', inventory_account_id,   -- CREDIT: total_cogs (expected 0)
    'credit', total_cogs,
    'description', 'Inventory reduction'
  )
);
```

**Expected Result**: Array with 4 entries (2 debits, 2 credits)

#### Step 2: Tax Lines Append (Lines 410-478)
**Condition Check (Line 412)**: `IF array_length(parsed_tax_lines, 1) > 0 THEN`
- If TRUE: Loop through tax lines and append credit entries
- If FALSE: Falls to line 461 `ELSIF total_tax_amount > 0 THEN`

**Append Operation (Line 442)**:
```sql
journal_lines := journal_lines || jsonb_build_array(
  jsonb_build_object(
    'account_id', tax_account_id,
    'credit', tax_amount,
    'description', COALESCE(tax_code, 'Tax') || ' tax'
  )
);
```

**Fallback Append (Line 471)**:
```sql
journal_lines := journal_lines || jsonb_build_array(
  jsonb_build_object(
    'account_id', vat_payable_account_id,
    'credit', total_tax_amount,
    'description', 'Tax payable (tax-inclusive sale)'
  )
);
```

### Summary of Append Points
1. **Line 387**: Initial `jsonb_build_array` (4 entries: 2 debit, 2 credit)
2. **Line 442**: Tax line credit append (conditional, inside loop)
3. **Line 451**: Tax line debit append (conditional, should not occur for sales)
4. **Line 471**: VAT Payable fallback credit (conditional)

---

## 2. Credit Line Conditions

### Revenue Credit
- **Location**: Line 393-397
- **Value**: `net_total` (calculated at line 322)
- **Condition**: Always added (unconditional in initial array)
- **Calculation**: `net_total := ROUND(gross_total - total_tax_amount, 2)`
- **Failure Scenario**: If `net_total = 0`, revenue credit is 0

### Tax Payable Credit
- **Location**: Lines 412-460 (tax lines loop) OR Lines 461-478 (fallback)
- **Condition 1 (Line 412)**: `IF array_length(parsed_tax_lines, 1) > 0`
  - **Sub-condition (Line 432)**: `IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0`
  - **Sub-condition (Line 441)**: `IF tax_ledger_side = 'credit'`
- **Condition 2 (Line 461)**: `ELSIF total_tax_amount > 0`
  - **Sub-condition (Line 464)**: `vat_payable_account_id` must not be NULL
- **Failure Scenarios**:
  - `parsed_tax_lines` is empty AND `total_tax_amount = 0`
  - Tax line has NULL `ledger_account_code` AND mapping fails
  - Tax line has `ledger_side != 'credit'` (unexpected)
  - `tax_account_id` is NULL (account lookup fails)

### Inventory Credit
- **Location**: Line 403-407
- **Value**: `total_cogs` (calculated at lines 288-291)
- **Condition**: Always added (unconditional in initial array)
- **Calculation**: `SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0) FROM sale_items WHERE sale_id = p_sale_id`
- **Failure Scenario**: If `total_cogs = 0`, inventory credit is 0 (this is expected for sales without cost tracking)

---

## 3. Runtime Shape Analysis

### Variable Assignments Before journal_lines Construction

#### gross_total
- **Line 268**: `gross_total := COALESCE(sale_record.amount, 0)`
- **Source**: `sales.amount` column
- **Expected**: 100.00
- **Runtime Value**: **100.00** (confirmed by error: "Debit total: 100")

#### net_total
- **Line 322**: `net_total := ROUND(gross_total - total_tax_amount, 2)`
- **Dependencies**: `gross_total`, `total_tax_amount`
- **Calculation**: `ROUND(100 - total_tax_amount, 2)`
- **Runtime Value**: **UNKNOWN** (if credit = 0, either `net_total = 0` or `account_id` is NULL)

#### total_tax_amount
- **Lines 312, 321**: Calculated and rounded
- **Source**: Sum of `tax_line_item->>'amount'` from parsed_tax_lines
- **Runtime Value**: **UNKNOWN** (must be calculated to determine if tax credits are added)

#### total_cogs
- **Lines 288-291**: `SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0) FROM sale_items`
- **Expected**: 0 (for sales without cost tracking)
- **Runtime Value**: **Likely 0** (inventory credit = 0 is acceptable)

### Account ID Retrieval (Before journal_lines Build)

#### cash_account_id
- **Line 364**: `get_account_by_control_key(business_id_val, 'CASH')`
- **Validation**: Line 370-372 (RAISE EXCEPTION if NULL)
- **Runtime Status**: **NOT NULL** (validation would fail otherwise)

#### revenue_account_id
- **Line 365**: `get_account_by_code(business_id_val, '4000')`
- **Validation**: Line 373-375 (RAISE EXCEPTION if NULL)
- **Runtime Status**: **UNKNOWN** (validation passes but account_id might be NULL in JSONB if get_account_by_code returns NULL after validation)

#### cogs_account_id
- **Line 366**: `get_account_by_code(business_id_val, '5000')`
- **Validation**: Line 376-378 (RAISE EXCEPTION if NULL)
- **Runtime Status**: **UNKNOWN**

#### inventory_account_id
- **Line 367**: `get_account_by_code(business_id_val, '1200')`
- **Validation**: Line 379-381 (RAISE EXCEPTION if NULL)
- **Runtime Status**: **UNKNOWN**

### Critical Finding: Validation vs. Assignment Gap

**Observation**: Account IDs are validated (lines 370-381), but validation happens BEFORE account IDs are retrieved:
- Line 334-338: `PERFORM assert_account_exists(...)` (validates account codes exist)
- Line 364-367: Account IDs retrieved via `get_account_by_code()` / `get_account_by_control_key()`
- Line 370-381: Validation checks if retrieved IDs are NULL

**Potential Issue**: If `get_account_by_code()` returns NULL AFTER `assert_account_exists()` passes, the validation at lines 370-381 should catch it. However, if validation passes but `account_id` becomes NULL between validation and JSONB construction, credits would have NULL `account_id` values.

### JSONB Construction with NULL account_id

**Hypothesis**: If `revenue_account_id`, `cogs_account_id`, or `inventory_account_id` are NULL when `jsonb_build_object()` is called, the resulting JSONB will contain:
```json
{
  "account_id": null,
  "credit": <value>,
  "description": "..."
}
```

**Impact**: `post_journal_entry()` processes journal_lines (line 150-157 in migration 179):
```sql
FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
LOOP
  account_id := (line->>'account_id')::UUID;
  IF account_id IS NULL THEN
    RAISE EXCEPTION 'Account ID is NULL in journal entry line...';
  END IF;
  -- Insert into journal_entry_lines
END LOOP;
```

**If account_id is NULL**: Exception should be raised BEFORE balance validation. Since we're seeing "Debit: 100, Credit: 0", this suggests:
1. Account IDs are NOT NULL (validation passed)
2. Credit VALUES are 0 (net_total = 0, total_cogs = 0, total_tax_amount = 0)

---

## 4. Multiple INSERT / Early Exit Check

### Separate INSERT Operations
- **NONE**: All journal lines are constructed in `journal_lines` JSONB array first
- **Single INSERT**: All lines inserted via `post_journal_entry()` → single INSERT into `journal_entry_lines` table (loop at lines 150-157)

### Early Exit Points (Before Credits Added)

**Line 285**: `PERFORM assert_accounting_period_is_open(...)`
- **If fails**: Exception raised, function exits
- **Credit impact**: None (credits not yet constructed)

**Line 329-331**: `RAISE EXCEPTION` in CASH mapping block
- **If triggered**: Exception raised, function exits
- **Credit impact**: None (credits not yet constructed)

**Lines 370-381**: Account validation exceptions
- **If triggered**: Exception raised, function exits
- **Credit impact**: None (credits not yet constructed)

**Line 436-438**: Tax account not found exception
- **If triggered**: Exception raised inside tax loop
- **Credit impact**: Partial (base credits added, tax credits missing)

**Line 467-469**: VAT Payable account not found exception
- **If triggered**: Exception raised in fallback block
- **Credit impact**: Partial (base credits added, tax credits missing)

### Conclusion
**NO early exit prevents credits from being added** to the initial array (lines 387-408). All credit entries should be present in the initial `journal_lines` array.

---

## 5. Regression Source Analysis

### Migration 179 Changes
**File**: `supabase/migrations/179_retail_system_accountant_posting.sql`

**Changes from migration 178**:
1. Added `p_posted_by_accountant_id` parameter to `post_sale_to_ledger()`
2. Added system accountant resolution logic (lines 271-282)
3. Added `p_posted_by_accountant_id` parameter to `post_journal_entry()` call (line 503)

**Journal Lines Construction**: **IDENTICAL** to migration 178
- Same initial array build (lines 387-408)
- Same tax line append logic (lines 410-478)
- No changes to credit line construction

### Migration 178 (Previous Version)
**File**: `supabase/migrations/178_retail_tax_inclusive_posting_fix.sql`
- Same journal_lines construction logic
- Same credit line structure

### Conclusion
**NOT a regression from migration 179**. The journal_lines construction logic is unchanged. The issue exists in the current codebase and would have been present in migration 178 as well, but may have been masked by earlier failures (missing `posted_by_accountant_id`, missing tax serialization, etc.).

---

## 6. Root Cause Hypothesis

### Scenario: All Credit Values Are Zero

If `Credit total: 0`, possible causes:

1. **net_total = 0**
   - Implies: `gross_total - total_tax_amount = 0`
   - Implies: `total_tax_amount = 100`
   - **Inconsistent**: If total_tax = 100, tax credits should be added (unless tax lines parsing fails)

2. **net_total = NULL or undefined**
   - If `net_total` is NULL, `jsonb_build_object('credit', NULL)` creates `{"credit": null}`
   - `post_journal_entry()` sums: `total_credit := total_credit + COALESCE((line->>'credit')::NUMERIC, 0)`
   - NULL coerced to 0, so credit = 0

3. **Account IDs are NULL in JSONB**
   - If `revenue_account_id` is NULL, `jsonb_build_object('account_id', NULL)` creates `{"account_id": null}`
   - `post_journal_entry()` line 152: `account_id := (line->>'account_id')::UUID`
   - Line 153: `IF account_id IS NULL THEN RAISE EXCEPTION`
   - **But**: Exception should be raised, not "Credit: 0"

### Most Likely Scenario

**Credit VALUES are 0, not missing**:
- `net_total = 0` (calculated incorrectly or tax_amount = gross_total)
- `total_cogs = 0` (expected, no cost tracking)
- `total_tax_amount = 0` (tax lines not parsed or tax_amount = 0)

**Evidence**: Error message shows "Credit total: 0" (not "missing credits"), suggesting:
- Credit LINES exist in journal_lines array
- Credit VALUES are all 0

---

## 7. Exact Failure Condition

### Condition Check Sequence

1. **Line 268**: `gross_total := COALESCE(sale_record.amount, 0)` → **100.00** ✓

2. **Lines 288-291**: `total_cogs` calculation → **Likely 0** (expected)

3. **Lines 293-316**: Tax lines parsing
   - **Line 295**: `IF tax_lines_jsonb IS NOT NULL THEN`
   - **Line 305**: `IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN`
   - **Line 309**: `IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN`
   - **Line 312**: `total_tax_amount := total_tax_amount + COALESCE((tax_line_item->>'amount')::NUMERIC, 0)`

4. **Line 321**: `total_tax_amount := ROUND(total_tax_amount, 2)`
   - **If parsing failed**: `total_tax_amount = 0`

5. **Line 322**: `net_total := ROUND(gross_total - total_tax_amount, 2)`
   - **If total_tax_amount = 0**: `net_total = ROUND(100 - 0, 2) = 100.00`
   - **If total_tax_amount = 100**: `net_total = ROUND(100 - 100, 2) = 0.00` ⚠️

6. **Lines 387-408**: journal_lines construction
   - Revenue credit = `net_total` → **If 0, credit = 0**
   - Inventory credit = `total_cogs` → **0** (expected)

7. **Line 412**: `IF array_length(parsed_tax_lines, 1) > 0 THEN`
   - **If FALSE**: Skip tax loop, go to line 461

8. **Line 461**: `ELSIF total_tax_amount > 0 THEN`
   - **If FALSE**: Skip fallback, no tax credits added

### Failure Path

**Most Likely**:
1. Tax lines parsing fails (empty array or NULL tax_lines_jsonb)
2. `total_tax_amount = 0`
3. `net_total = 100` (gross - 0)
4. Revenue credit = 100 (should balance)
5. **BUT**: Error says "Credit: 0"

**Alternative Path**:
1. Tax lines parsing succeeds but `total_tax_amount = 100`
2. `net_total = 0` (gross - 100)
3. Revenue credit = 0
4. Tax credits should be added, but condition fails

### Critical Check Needed

**Verify at runtime**:
- What is `total_tax_amount` after line 321?
- What is `net_total` after line 322?
- What is `array_length(parsed_tax_lines, 1)` at line 412?
- What is the actual JSONB shape of `journal_lines` before line 489?

---

## 8. Proof Locations

### File References
- **Function**: `post_sale_to_ledger()`
- **File**: `supabase/migrations/179_retail_system_accountant_posting.sql`
- **Lines**: 210-511

### Key Code Locations

1. **journal_lines Declaration**: Line 240
2. **Initial Array Build**: Lines 387-408
3. **Revenue Credit**: Lines 393-397
4. **Inventory Credit**: Lines 403-407
5. **Tax Credit Condition**: Line 412
6. **Tax Credit Append**: Line 442
7. **Fallback Tax Credit**: Line 471
8. **Function Call**: Line 489

### Missing Evidence

To confirm root cause, need runtime inspection of:
- `total_tax_amount` after line 321
- `net_total` after line 322
- `parsed_tax_lines` array length at line 412
- `journal_lines` JSONB shape before line 489
- Account ID values (revenue_account_id, inventory_account_id) at line 387

---

## Summary

### Facts Established
1. ✅ journal_lines is constructed in single array build (lines 387-408)
2. ✅ Credits ARE included in initial array (Revenue, Inventory)
3. ✅ Tax credits added conditionally (lines 412-478)
4. ✅ No early exit prevents credits from initial array
5. ✅ Account IDs are validated before journal_lines construction
6. ✅ Migration 179 did NOT change journal_lines construction logic

### Hypothesis
**Credit VALUES are 0, not missing**:
- Revenue credit = `net_total` = 0 (if `total_tax_amount = gross_total`)
- Inventory credit = `total_cogs` = 0 (expected)
- Tax credits = 0 (if tax lines not parsed or `total_tax_amount = 0`)

### Required Investigation
**Runtime inspection needed** to confirm:
- Actual values of `net_total`, `total_tax_amount`, `total_cogs` before journal_lines construction
- JSONB shape of `journal_lines` array before `post_journal_entry()` call
- Whether credit entries have NULL values or zero values

---

**Report Generated**: Inspection only - no fixes implemented
**Status**: Ready for runtime debugging
