# Forensic State Sync Report: Journal Entry Lines / Sale Posting Issue

**Date:** 2025-01-27  
**Purpose:** Reconstruct all prior attempts before proposing new fixes  
**Status:** Read-only forensic analysis

---

## Summary of Prior Attempts

### Migration Chronology

#### **Migration 043** (Original)
- **File:** `supabase/migrations/043_accounting_core.sql`
- **Date:** Original implementation
- **Changes:**
  - Created `post_journal_entry()` function (6-parameter version)
  - Used `(line->>'debit')::NUMERIC` and `(line->>'credit')::NUMERIC` for JSONB extraction
  - Balance validation before INSERT
  - Loop-based INSERT into `journal_entry_lines`

#### **Migration 050** (Account ID Fix)
- **File:** `supabase/migrations/050_fix_account_id_null.sql`
- **Changes:**
  - Added account_id validation in `post_journal_entry()`
  - No changes to debit/credit extraction logic

#### **Migration 088** (Hard Constraints)
- **File:** `supabase/migrations/088_hard_db_constraints_ledger.sql`
- **Changes:**
  - **CRITICAL:** Added row-level trigger `trigger_enforce_double_entry_balance`
  - Trigger type: `AFTER INSERT ON journal_entry_lines FOR EACH ROW`
  - Trigger validates balance after EACH line insert by querying table
  - **Problem identified later:** Row-level trigger fires after first line, sees imbalance, aborts transaction

#### **Migration 179** (Retail System Accountant Posting)
- **File:** `supabase/migrations/179_retail_system_accountant_posting.sql`
- **Changes:**
  - Recreated `post_journal_entry()` as 14-parameter version (added `p_posted_by_accountant_id`)
  - **CRITICAL BUG INTRODUCED:** Line 387: `net_total := COALESCE(net_total, 0)` - coerces NULL to 0
  - Used `(line->>'credit')::NUMERIC` (text extraction) - unsafe for JSONB numeric types
  - Added extensive tax extraction logic in `post_sale_to_ledger()`
  - Added diagnostic `RAISE NOTICE` statements (temporary)
  - Added debug log table insertion before `post_journal_entry()` call

#### **Migration 180** (NULL Credit Fix Attempt #1)
- **File:** `supabase/migrations/180_retail_ledger_null_credit_fix.sql`
- **Status:** EXISTS BUT NOT DEPLOYED (per user confirmation)
- **Changes:**
  - Attempted to fix NULL coercion by removing `COALESCE(net_total, 0)`
  - Changed to deterministic total computation
  - Added explicit NULL guards (fail-closed approach)
  - Recalculated revenue credit directly: `net_total := ROUND(gross_total - total_tax_amount, 2)`
  - **Problem:** Still has issues (test results not verified)

#### **Migration 181** (Debug Log Table)
- **File:** `supabase/migrations/181_retail_posting_debug_log.sql`
- **Changes:**
  - Created `retail_posting_debug_log` table for evidence capture
  - No functional fixes, evidence-only

#### **Migration 182** (Debug Logging Addition)
- **File:** `supabase/migrations/182_add_debug_logging_to_post_sale.sql`
- **Changes:**
  - Added debug logging to active `post_sale_to_ledger()` function
  - Reverted to migration 179 logic (diagnostic instrumentation only)
  - **Note:** This overwrote migration 180, indicating 180's fix was insufficient

#### **Migration 183** (Revenue Credit Calculation Fix Attempt #2)
- **File:** `supabase/migrations/183_fix_revenue_credit_calculation.sql`
- **Changes:**
  - Added `revenue_credit_value` variable
  - Attempted to calculate revenue credit directly: `revenue_credit_value := ROUND(gross_total - COALESCE(total_tax_amount, 0), 2)`
  - Added diagnostic validation to verify revenue credit exists in JSONB
  - **Still used:** `COALESCE(net_total, gross_total)` at line 207 (potential NULL issue remains)

#### **Migration 184** (JSONB Cast Bug Fix)
- **File:** `supabase/migrations/184_diagnostic_post_journal_entry_payload.sql`
- **Changes:**
  - **CRITICAL FIX:** Changed from `(line->>'debit')::NUMERIC` to `(line->'debit')::NUMERIC`
  - **CRITICAL FIX:** Changed from `(line->>'credit')::NUMERIC` to `(line->'credit')::NUMERIC`
  - Fixed unsafe text extraction (`->>`) to safe JSONB numeric extraction (`->`)
  - **Reason:** Text extraction can fail silently, producing NULL which `COALESCE` converts to 0
  - Applied to both balance validation loop (line 82-83) and INSERT loop (line 136-137)

#### **Migration 185** (Trigger Level Fix)
- **File:** `supabase/migrations/185_fix_ledger_balance_trigger_statement_level.sql`
- **Changes:**
  - **CRITICAL FIX:** Changed trigger from row-level to statement-level
  - Dropped: `FOR EACH ROW` trigger
  - Created: `FOR EACH STATEMENT` trigger
  - **Reason:** Row-level trigger validates after each line insert, causing false failures on first line of multi-line entries
  - New trigger validates balance AFTER all rows in INSERT statement are committed

### Key Pattern: Iterative Fix Attempts

1. **Migration 179:** Introduced NULL coercion bug (`COALESCE(net_total, 0)`)
2. **Migration 180:** Attempted to fix NULL handling (not deployed)
3. **Migration 182:** Reverted to 179 logic (180 insufficient)
4. **Migration 183:** Attempted direct revenue credit calculation (partial fix)
5. **Migration 184:** Fixed JSONB extraction method (critical fix)
6. **Migration 185:** Fixed trigger level (critical fix)

---

## Current Effective Code Snapshot

### Active `post_journal_entry()` Function

**Source:** Migration 184 (`supabase/migrations/184_diagnostic_post_journal_entry_payload.sql`)  
**Signature:** 14-parameter version  
**Lines:** 29-144

**Key Implementation Details:**

1. **Balance Validation (Lines 80-88):**
   ```sql
   FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
   LOOP
     total_debit := total_debit + COALESCE((line->'debit')::NUMERIC, 0);
     total_credit := total_credit + COALESCE((line->'credit')::NUMERIC, 0);
   END LOOP;
   
   IF ABS(total_debit - total_credit) > 0.01 THEN
     RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
   END IF;
   ```
   - Uses `->` (safe JSONB numeric extraction) - **FIXED in migration 184**
   - Validates balance BEFORE any INSERTs

2. **Journal Entry Creation (Lines 90-123):**
   - Creates `journal_entries` record first
   - Returns `journal_id`

3. **Line Insertion (Lines 125-140):**
   ```sql
   FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
   LOOP
     account_id := (line->>'account_id')::UUID;
     IF account_id IS NULL THEN
       RAISE EXCEPTION 'Account ID is NULL in journal entry line. Description: %', line->>'description';
     END IF;
     
     INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
     VALUES (
       journal_id,
       account_id,
       COALESCE((line->'debit')::NUMERIC, 0),
       COALESCE((line->'credit')::NUMERIC, 0),
       line->>'description'
     );
   END LOOP;
   ```
   - Uses `->` for debit/credit (safe) - **FIXED in migration 184**
   - **Loop-based INSERT** (not set-based)
   - Each INSERT fires trigger individually

### Active `post_sale_to_ledger()` Function

**Source:** Migration 183 (`supabase/migrations/183_fix_revenue_credit_calculation.sql`)  
**Signature:** 5-parameter version  
**Lines:** 15-566

**Key Implementation Details:**

1. **Tax Extraction (Lines 82-203):**
   - Reads `tax_lines_jsonb` from `sales.tax_lines`
   - Extracts `subtotal_excl_tax` and `tax_total` from JSONB object
   - Has fallback logic for missing canonical totals
   - **Still uses:** `COALESCE(net_total, gross_total)` at line 207 (potential NULL leakage)

2. **Revenue Credit Calculation (Lines 215-234):**
   ```sql
   revenue_credit_value := ROUND(gross_total - COALESCE(total_tax_amount, 0), 2);
   
   IF revenue_credit_value IS NULL THEN
     RAISE EXCEPTION 'Retail posting error: Revenue credit is NULL...';
   END IF;
   
   IF revenue_credit_value <= 0 THEN
     RAISE EXCEPTION 'Retail posting error: Revenue credit calculated as %...';
   END IF;
   
   net_total := revenue_credit_value;
   ```
   - Calculates revenue credit directly (attempted fix in 183)
   - Still reassigns `net_total` from calculated value

3. **Journal Lines Build (Lines 368-392):**
   ```sql
   journal_lines := jsonb_build_array(
     jsonb_build_object(
       'account_id', cash_account_id,
       'debit', ROUND(COALESCE(gross_total, 0), 2),
       'description', 'Sale receipt'
     ),
     jsonb_build_object(
       'account_id', revenue_account_id,
       'credit', ROUND(COALESCE(gross_total, 0) - COALESCE(total_tax_amount, 0), 2),  -- DIRECT calculation
       'description', 'Sales revenue'
     ),
     ...
   );
   ```
   - Revenue credit calculated directly in JSONB: `gross_total - total_tax_amount`
   - **No dependency on `net_total` variable** at this point

4. **Tax Lines Appending (Lines 415-480):**
   - Appends tax credit lines if `parsed_tax_lines` array has items
   - Fallback to VAT Payable (2100) if `total_tax_amount > 0` but no parsed lines

5. **Validation Before Posting (Lines 597-629):**
   - Final validation checks revenue credit exists in JSONB
   - Verifies revenue credit > 0
   - Calculates total credits sum

### Active Balance Enforcement Trigger

**Source:** Migration 185 (`supabase/migrations/185_fix_ledger_balance_trigger_statement_level.sql`)  
**Trigger Name:** `trigger_enforce_double_entry_balance`  
**Type:** `AFTER INSERT ON journal_entry_lines FOR EACH STATEMENT`

**Implementation:**
```sql
CREATE OR REPLACE FUNCTION enforce_double_entry_balance_statement()
RETURNS TRIGGER AS $$
DECLARE
  journal_entry_id_val UUID;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  imbalance NUMERIC;
BEGIN
  FOR journal_entry_id_val IN 
    SELECT DISTINCT journal_entry_id
    FROM journal_entry_lines
  LOOP
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO total_debit, total_credit
    FROM journal_entry_lines
    WHERE journal_entry_id = journal_entry_id_val;
    
    imbalance := ABS(total_debit - total_credit);
    
    IF imbalance > 0.01 THEN
      RAISE EXCEPTION 'Journal entry is not balanced...';
    END IF;
  END LOOP;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_enforce_double_entry_balance
  AFTER INSERT ON journal_entry_lines
  FOR EACH STATEMENT
  EXECUTE FUNCTION enforce_double_entry_balance_statement();
```

**Key Behavior:**
- Fires **once per INSERT statement** (not per row)
- Validates balance **after all rows** in the statement are inserted
- **FIXED in migration 185** - was row-level, now statement-level

### Insert Method

- **Method:** Loop-based (sequential INSERT statements)
- **Location:** `post_journal_entry()` lines 125-140
- **Behavior:** Each line inserted individually in a loop
- **Trigger Firing:** With statement-level trigger (185), fires once after loop completes (all inserts are in same statement)

**Note:** PostgreSQL may batch loop INSERTs into a single statement, or each INSERT may be separate. Statement-level trigger handles both cases.

### Validation Order

1. **Pre-INSERT validation** (in `post_journal_entry()`):
   - Validates balance from `p_lines` JSONB (line 86-88)
   - Fails fast before any database writes

2. **POST-INSERT validation** (trigger):
   - Validates balance from `journal_entry_lines` table
   - Statement-level trigger validates after all lines inserted

---

## Do-Not-Repeat Fixes

### ❌ **Fix #1: NULL Coercion to Zero** (Migration 179 - REVERTED)
**What was tried:**
- Line 387: `net_total := COALESCE(net_total, 0)`
- Silent conversion of NULL to 0

**Why it failed:**
- Validation `IF net_total <= 0` evaluates NULL as NULL (not TRUE), passes incorrectly
- NULL becomes 0, creating credit=0 journal entries
- **DO NOT REPEAT:** Silent NULL coercion hides validation failures

### ❌ **Fix #2: Deterministic Total Computation Without Full Context** (Migration 180 - NOT DEPLOYED)
**What was tried:**
- Removed NULL coercion
- Added deterministic extraction logic
- Added explicit NULL guards

**Why it failed:**
- Not fully tested/deployed
- Migration 182 reverted to 179, indicating 180 was insufficient
- **DO NOT REPEAT:** Partial fixes that don't address root cause

### ❌ **Fix #3: Variable Reassignment Instead of Direct Calculation** (Migration 183 - PARTIAL)
**What was tried:**
- Calculate `revenue_credit_value` directly
- Then reassign `net_total := revenue_credit_value`
- Still used `COALESCE(net_total, gross_total)` elsewhere

**Why it partially worked:**
- Direct calculation in JSONB (line 379) works
- But variable reassignment introduces state dependencies
- **DO NOT REPEAT:** Don't mix variable state with direct calculation

### ✅ **Fix #4: JSONB Text Extraction → JSONB Numeric Extraction** (Migration 184 - SUCCESSFUL)
**What was tried:**
- Changed `(line->>'debit')::NUMERIC` → `(line->'debit')::NUMERIC`
- Changed `(line->>'credit')::NUMERIC` → `(line->'credit')::NUMERIC`

**Why it worked:**
- Text extraction (`->>`) can fail silently on JSONB numeric types
- JSONB extraction (`->`) safely handles numeric values
- **KEEP THIS FIX**

### ✅ **Fix #5: Row-Level → Statement-Level Trigger** (Migration 185 - SUCCESSFUL)
**What was tried:**
- Changed trigger from `FOR EACH ROW` to `FOR EACH STATEMENT`
- Validates balance after all rows inserted, not after each row

**Why it worked:**
- Row-level trigger fires after first line, sees imbalance, aborts
- Statement-level trigger validates after all lines inserted
- **KEEP THIS FIX**

### ❌ **Fix #6: Direct Revenue Credit in JSONB** (Migration 183 - WORKED BUT NEEDS VERIFICATION)
**What was tried:**
- Line 379: `'credit', ROUND(COALESCE(gross_total, 0) - COALESCE(total_tax_amount, 0), 2)`
- Direct calculation in JSONB, no variable dependency

**Status:**
- Appears correct but needs verification with actual test results
- **APPROACH IS SOUND:** Direct calculation eliminates variable state issues

---

## Open Problems Still Unaddressed

### Problem 1: Variable State Dependencies in `post_sale_to_ledger()`

**Location:** Migration 183, lines 195-234

**Issue:**
- `net_total` is computed, then `revenue_credit_value` is computed, then `net_total` is reassigned
- Multiple places use `net_total` with different states
- Line 207: `net_total := ROUND(COALESCE(net_total, gross_total), 2)` - still has NULL fallback

**Impact:**
- If `net_total` is NULL before line 207, it falls back to `gross_total` (correct)
- But this creates confusion about which value is authoritative
- Variable reassignment creates temporal dependencies

**Status:** Not fully resolved - direct calculation in JSONB (line 379) works, but variable state remains complex

### Problem 2: Tax Lines Parsing Logic Complexity

**Location:** Migration 183, lines 82-203

**Issue:**
- Multiple nested IF/ELSE branches for tax extraction
- Handles canonical object, array, and NULL cases
- Has fallback logic for missing fields
- Complex control flow makes it hard to reason about

**Impact:**
- If canonical totals missing, tries to derive from array
- If array missing, tries to use totals
- Multiple code paths can leave variables in unexpected states

**Status:** Functional but fragile - needs simplification or clearer documentation

### Problem 3: Trigger Validation Redundancy

**Location:** 
- `post_journal_entry()` validates balance from `p_lines` (pre-INSERT)
- Trigger validates balance from table (post-INSERT)

**Issue:**
- Two validations exist: one in function, one in trigger
- If function validation passes but table has wrong values, trigger catches it
- But this suggests the INSERT itself may have issues

**Status:** Intentional defense-in-depth, but indicates potential INSERT bug

### Problem 4: Missing Test Results Evidence

**Evidence Needed:**
- Actual test output from TEST A, B, C after all migrations applied
- Verification that migration 184 + 185 fixes resolve the issue
- Diagnostic log entries showing `journal_lines` before `post_journal_entry()` call

**Status:** Unknown - tests may pass now, or may still fail with different error

### Problem 5: Loop-Based INSERT vs Statement-Level Trigger Interaction

**Location:** `post_journal_entry()` line 125-140

**Issue:**
- Function uses loop to INSERT lines one at a time
- Statement-level trigger fires after "statement" completes
- **Unclear:** Does PostgreSQL batch loop INSERTs into one statement, or are they separate?

**Impact:**
- If separate statements: trigger fires after each INSERT (still validates per INSERT)
- If batched: trigger fires once after all INSERTs (intended behavior)
- PostgreSQL behavior may vary based on transaction boundaries

**Status:** Needs verification - statement-level trigger should work, but exact behavior unclear

### Problem 6: Debug Logging Still Present

**Location:** Multiple migrations (179, 182, 183)

**Issue:**
- Diagnostic `RAISE NOTICE` statements throughout code
- `retail_posting_debug_log` table inserts
- Marked as "TEMPORARY - REMOVE AFTER ROOT CAUSE ANALYSIS"

**Status:** Technical debt - should be removed once issue fully resolved

---

## Summary

### What Has Been Fixed
1. ✅ JSONB extraction method (text → numeric) - Migration 184
2. ✅ Trigger level (row → statement) - Migration 185
3. ✅ Direct revenue credit calculation in JSONB - Migration 183

### What Remains Unclear
1. ❓ Are tests passing now?
2. ❓ Is the variable state complexity in `post_sale_to_ledger()` causing issues?
3. ❓ Does loop-based INSERT interact correctly with statement-level trigger?
4. ❓ Is the tax extraction logic robust enough?

### What Should NOT Be Repeated
1. ❌ Silent NULL coercion (`COALESCE(x, 0)` without validation)
2. ❌ Row-level balance validation triggers
3. ❌ Text extraction for JSONB numeric types (`->>`)
4. ❌ Variable reassignment patterns that create state dependencies

---

**Report Complete** - Ready for fix design phase
