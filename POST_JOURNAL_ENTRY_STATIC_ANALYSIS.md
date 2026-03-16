# Static Analysis: post_journal_entry() Debit/Credit Logic

## Function Analyzed
- **Function**: `public.post_journal_entry()` (14-parameter version)
- **Location**: `supabase/migrations/179_retail_system_accountant_posting.sql` (lines 29-160)
- **OID**: Latest (89731 per user's diagnostic output)

---

## FINDING 1: Canonical p_lines Accumulation Loop

**Line Numbers**: 96-100

**Exact Code**:
```sql
FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
LOOP
  total_debit := total_debit + COALESCE((line->>'debit')::NUMERIC, 0);
  total_credit := total_credit + COALESCE((line->>'credit')::NUMERIC, 0);
END LOOP;
```

**Condition/Trigger**: Always executes (unconditional)

**What it does**: 
- Accumulates `total_debit` and `total_credit` from `p_lines` JSONB array
- Uses `COALESCE` to convert NULL to 0 for each line

**Bypasses/duplicates p_lines**: No - this IS the canonical path

**Can explain Credit=0**: 
- **YES** - If `total_debit` or `total_credit` start as NULL (not initialized), then `NULL + value = NULL`
- **However**: Lines 49-50 show `:= 0` initialization, so this should work correctly

**Can explain Credit=116.66**: No - this loop only sums what's in `p_lines`

---

## FINDING 2: Balance Validation

**Line Numbers**: 102-104

**Exact Code**:
```sql
IF ABS(total_debit - total_credit) > 0.01 THEN
  RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
END IF;
```

**Condition/Trigger**: Always executes (unconditional)

**What it does**: 
- Validates that accumulated totals from Finding 1 are balanced
- Raises exception if imbalance > 0.01

**Bypasses/duplicates p_lines**: No - uses totals from canonical loop

**Can explain Credit=0**: 
- **YES** - If `total_credit` is NULL (from NULL accumulator bug), then `ABS(100 - NULL)` = NULL, and `NULL > 0.01` = NULL (falsy), so validation passes incorrectly
- **However**: With proper initialization, this should catch imbalances

**Can explain Credit=116.66**: No - this only validates, doesn't modify

---

## FINDING 3: Journal Entry Lines Insertion Loop

**Line Numbers**: 141-156

**Exact Code**:
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
    COALESCE((line->>'debit')::NUMERIC, 0),
    COALESCE((line->>'credit')::NUMERIC, 0),
    line->>'description'
  );
END LOOP;
```

**Condition/Trigger**: Always executes (unconditional)

**What it does**: 
- Inserts journal_entry_lines from `p_lines` JSONB
- Uses `COALESCE` to convert NULL to 0 for debit/credit

**Bypasses/duplicates p_lines**: No - inserts exactly what's in `p_lines`

**Can explain Credit=0**: 
- **YES** - If `(line->>'credit')::NUMERIC` evaluates to NULL (e.g., if JSONB key is missing or value is invalid), then `COALESCE(NULL, 0) = 0`
- **However**: Diagnostic shows JSONB has `"credit": 83.34`, so this should work

**Can explain Credit=116.66**: No - this only inserts what's in `p_lines`

---

## FINDING 4: Trigger-Based Balance Validation (EXTERNAL)

**Location**: `supabase/migrations/088_hard_db_constraints_ledger.sql` (lines 115-151)

**Trigger Name**: `trigger_enforce_double_entry_balance`
**Trigger Type**: `AFTER INSERT ON journal_entry_lines`

**Exact Code**:
```sql
CREATE OR REPLACE FUNCTION enforce_double_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  imbalance NUMERIC;
BEGIN
  -- Calculate totals for all lines in this journal entry (including the one just inserted)
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO total_debit, total_credit
  FROM journal_entry_lines
  WHERE journal_entry_id = NEW.journal_entry_id;
  
  imbalance := ABS(total_debit - total_credit);
  
  IF imbalance > 0.01 THEN
    RAISE EXCEPTION 'Journal entry is not balanced. Debit total: %, Credit total: %, Difference: %. Double-entry requires SUM(debit) = SUM(credit). Tip: Use post_journal_entry() function or insert all lines in a single INSERT statement.',
      total_debit, total_credit, imbalance;
  END IF;
  
  RETURN NEW;
END;
```

**Condition/Trigger**: Fires AFTER each INSERT into `journal_entry_lines`

**What it does**: 
- Recomputes totals from `journal_entry_lines` table (not from `p_lines`)
- Validates balance after each line insert
- **This is the source of the error message**: "Journal entry is not balanced. Debit total: 100.00, Credit total: 0"

**Bypasses/duplicates p_lines**: 
- **YES** - This completely bypasses `p_lines` and reads from the table
- If the table has incorrect values (credit=0), this trigger will see them

**Can explain Credit=0**: 
- **YES** - This is the most likely culprit
- The trigger reads from `journal_entry_lines` table
- If `credit` column in table is 0 (due to NULL coercion in Finding 3), trigger will see `SUM(credit) = 0`
- The error message format matches exactly: "Debit total: 100.00, Credit total: 0"

**Can explain Credit=116.66**: 
- **YES** - If table has duplicate tax lines or extra lines, trigger will sum them all
- If `post_journal_entry()` inserts correct lines, but then something else inserts additional tax lines, trigger will see the sum

---

## FINDING 5: Variable Initialization

**Line Numbers**: 49-50

**Exact Code**:
```sql
total_debit NUMERIC := 0;
total_credit NUMERIC := 0;
```

**Condition/Trigger**: Variable declarations (always initialized)

**What it does**: 
- Initializes accumulators to 0 (not NULL)

**Bypasses/duplicates p_lines**: N/A - initialization only

**Can explain Credit=0**: 
- **NO** - These are correctly initialized
- However, if there was a version without `:= 0`, that would cause NULL accumulator bug

**Can explain Credit=116.66**: No

---

## FINDING 6: No Conditional Logic Based on p_reference_type

**Search Results**: 
- Line 59: `IF p_reference_type != 'adjustment'` - validation only, no debit/credit logic
- Line 127: `p_reference_type` - only used in INSERT, not in calculations

**Conclusion**: No legacy logic that conditionally recomputes totals based on `p_reference_type = 'sale'`

---

## FINDING 7: No Tax Logic in post_journal_entry()

**Search Results**: 
- No references to `tax`, `vat`, `apply_tax` in `post_journal_entry()` function body
- All tax logic is in `post_sale_to_ledger()`, which calls `post_journal_entry()` with pre-computed `p_lines`

**Conclusion**: No legacy tax recomputation in `post_journal_entry()`

---

## FINDING 8: No Additional Loops

**Search Results**: 
- Only two loops in function: both iterate `jsonb_array_elements(p_lines)`
- No other loops that process debit/credit

**Conclusion**: No legacy loops that bypass `p_lines`

---

## FINDING 9: No CASE Statements Affecting Debit/Credit

**Search Results**: 
- Line 133-136: `CASE` statements only for `entry_type`, `backfill_reason`, `backfill_at`, `backfill_actor` - metadata only
- No `CASE` statements that modify debit/credit values

**Conclusion**: No conditional debit/credit logic via CASE

---

## FINDING 10: No SUM() Aggregations Outside p_lines Loop

**Search Results**: 
- No `SUM()` calls in `post_journal_entry()` function body
- Only `SUM()` is in the external trigger (Finding 4)

**Conclusion**: No additional aggregation logic in function

---

## CRITICAL DISCOVERY: The Real Issue

The error message format **exactly matches** the trigger's error message:
```
"Journal entry is not balanced. Debit total: 100.00, Credit total: 0, Difference: 100.00. Double-entry requires SUM(debit) = SUM(credit). Tip: Use post_journal_entry() function or insert all lines in a single INSERT statement."
```

This is from `enforce_double_entry_balance()` trigger (line 135 in migration 088), NOT from `post_journal_entry()` validation (line 103 in migration 179).

**This means**:
1. `post_journal_entry()` correctly validates `p_lines` (Finding 1-2)
2. `post_journal_entry()` inserts lines into table (Finding 3)
3. **Trigger fires AFTER each insert** and reads from table
4. **Trigger sees `credit = 0` in the table** (not in `p_lines`)
5. Trigger raises the error

**Root Cause Hypothesis**:
- The `COALESCE((line->>'credit')::NUMERIC, 0)` in Finding 3 is evaluating to 0
- This could happen if:
  - JSONB extraction fails silently
  - Type casting fails and returns NULL, which COALESCE converts to 0
  - The JSONB structure is different than expected

**However**, the diagnostic exception shows the JSONB is correct. So the issue must be in the INSERT statement itself.

---

## Legacy Override Summary

### Number of Independent Debit/Credit Accumulation Paths Found: **1**

**Path**: `enforce_double_entry_balance()` trigger (Finding 4)

### Which One(s) Must Be Disabled or Guarded When `p_lines IS NOT NULL`:

**NONE** - The trigger is correct and necessary. The issue is that the INSERT statement (Finding 3) is inserting `credit = 0` into the table, and the trigger correctly detects this.

### Which One Explains TEST B Credit = 116.66:

**The trigger (Finding 4)** - If the table somehow has duplicate tax lines or extra lines totaling 116.66, the trigger will sum them all and report that total. However, the diagnostic shows `p_lines` only has 83.34 + 16.66 = 100.00, so if the table shows 116.66, something is inserting extra lines or modifying values after `post_journal_entry()` inserts them.

### Additional Finding:

The `post_journal_entry()` function itself has **NO legacy override logic**. All debit/credit logic is:
1. Canonical accumulation from `p_lines` (Finding 1)
2. Balance validation (Finding 2)  
3. Insertion from `p_lines` (Finding 3)

The error is coming from the **external trigger** that validates the table state, not from `post_journal_entry()` recomputing totals.

**Conclusion**: The bug is in **Finding 3** (INSERT statement) - it's inserting `credit = 0` into the table despite `p_lines` having correct values. The trigger (Finding 4) is correctly detecting this imbalance.
