# Theoretical Analysis: Expected Behavior Based on Code Review

**Date:** 2025-01-27  
**Purpose:** Predict expected behavior before running actual tests  
**Status:** Code analysis only - actual results may differ

---

## Critical Finding: Statement-Level Trigger with Loop INSERTs

### PostgreSQL Statement-Level Trigger Behavior

**Important Caveat:** PostgreSQL statement-level triggers (`FOR EACH STATEMENT`) fire **once per SQL statement**, not once per transaction.

**What this means for `post_journal_entry()`:**

```sql
FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
LOOP
  INSERT INTO journal_entry_lines (...) VALUES (...);  -- This is ONE SQL statement
END LOOP;
```

**Each `INSERT` inside the loop is a separate SQL statement.**

**Therefore:**
- If `post_journal_entry()` inserts 4 lines in a loop, that's **4 separate INSERT statements**
- Statement-level trigger will fire **4 times** (once after each INSERT)
- This may still cause false failures if balance is checked after first insert

### Verification Needed

The statement-level trigger fix (migration 185) may **not fully resolve** the issue if each loop iteration executes a separate SQL statement.

**However**, the trigger function loops through ALL journal entries in the table, not just NEW. This means:
- After first INSERT: Checks all entries (including the one just inserted)
- If entry is imbalanced at that point, trigger will fail
- If entry is balanced (all lines inserted), trigger will pass

**Expected Behavior:**
- **Optimistic:** Statement-level trigger only validates complete entries, so if all inserts happen in same transaction, it might work
- **Pessimistic:** Each INSERT is a statement, trigger fires after each, sees imbalance, fails

**This needs empirical verification** - see `test_trigger_semantics()` function.

---

## Expected Test Results (Based on Code Logic)

### TEST A: Canonical tax_lines Structure

**Input:**
- `gross_total` = 100.00
- `tax_lines_jsonb` = `{ tax_lines: [...], subtotal_excl_tax: 83.34, tax_total: 16.66 }`

**Expected Flow (Migration 183):**
1. Line 88-90: Extracts `subtotal_excl_tax` = 83.34
2. Line 127-129: Extracts `tax_total` = 16.66
3. Line 207: `net_total := ROUND(COALESCE(net_total, gross_total), 2)` → 83.34
4. Line 215-234: Calculates `revenue_credit_value` = 100.00 - 16.66 = 83.34
5. Line 379: Builds journal_lines with `'credit', ROUND(100.00 - 16.66, 2)` = 83.34
6. Line 415-480: Appends tax line (16.66 credit)

**Expected journal_lines:**
```json
[
  { account_id: cash_id, debit: 100.00, credit: 0 },
  { account_id: revenue_id, debit: 0, credit: 83.34 },  // Direct calculation
  { account_id: cogs_id, debit: 0, credit: 0 },
  { account_id: inventory_id, debit: 0, credit: 0 },
  { account_id: tax_id, debit: 0, credit: 16.66 }
]
```

**Expected Totals:**
- Intent: Debit 100.00, Credit 100.00 ✅
- JSONB: Debit 100.00, Credit 100.00 ✅
- Table: Debit 100.00, Credit 100.00 ✅

**Expected Result:** **PASS** (if trigger behavior is correct)

### TEST B: Parsed tax_lines Only

**Input:**
- `gross_total` = 100.00
- `tax_lines_jsonb` = `{ tax_lines: [{ code: 'VAT', amount: 16.66 }] }`
- No `subtotal_excl_tax` or `tax_total` keys

**Expected Flow (Migration 183):**
1. Line 88-106: `subtotal_excl_tax` not found, goes to ELSE
2. Line 114-125: `tax_total` not found in object
3. Line 127: `net_total := NULL` (explicitly set)
4. Line 154-193: Parses `tax_lines` array, extracts `total_tax_amount` = 16.66
5. Line 196-202: Calculates `net_total` = 100.00 - 16.66 = 83.34
6. Line 215-234: Calculates `revenue_credit_value` = 83.34
7. Line 379: Builds journal_lines with `'credit', ROUND(100.00 - 16.66, 2)` = 83.34
8. Line 415-480: Appends tax line (16.66 credit)

**Expected journal_lines:**
```json
[
  { account_id: cash_id, debit: 100.00, credit: 0 },
  { account_id: revenue_id, debit: 0, credit: 83.34 },
  { account_id: cogs_id, debit: 0, credit: 0 },
  { account_id: inventory_id, debit: 0, credit: 0 },
  { account_id: tax_id, debit: 0, credit: 16.66 }
]
```

**Expected Totals:**
- Intent: Debit 100.00, Credit 100.00 ✅
- JSONB: Debit 100.00, Credit 100.00 ✅
- Table: Debit 100.00, Credit 100.00 ✅

**Expected Result:** **PASS** (if trigger behavior is correct)

### TEST C: NULL tax_lines

**Input:**
- `gross_total` = 100.00
- `tax_lines_jsonb` = NULL

**Expected Flow (Migration 183):**
1. Line 298: `tax_lines_jsonb := sale_record.tax_lines` → NULL
2. Line 302: `IF tax_lines_jsonb IS NOT NULL` → FALSE
3. Line 364-368: ELSE branch executes
   - `net_total := gross_total` → 100.00
   - `total_tax_amount := 0`
4. Line 207: `net_total := ROUND(COALESCE(100.00, 100.00), 2)` → 100.00
5. Line 215-234: Calculates `revenue_credit_value` = 100.00 - 0 = 100.00
6. **BUT:** Migration 183 line 203-207 has explicit check:
   ```sql
   IF net_total IS NULL OR total_tax_amount IS NULL THEN
     RAISE EXCEPTION 'Retail posting error: Cannot determine net_total or total_tax_amount...'
   ```
   - This check should NOT trigger (both are non-NULL)
7. However, migration 183 may have been overwritten by later migrations...

**Wait:** Let me check migration 183 again...

**Actually:** Migration 183 line 147-151 has:
```sql
ELSE
  -- No tax_lines JSONB, assume all revenue (no tax)
  net_total := gross_total;
  total_tax_amount := 0;
END IF;
```

**Expected Result:** **PASS** (succeeds with revenue = 100.00, no tax)

**BUT:** Migration 180 (not deployed) has explicit failure for NULL tax_lines. Migration 183 might not have this check.

**Expected Result:** **UNCLEAR** - depends on which version is active.

---

## Expected Behavior: post_journal_entry() Function

### Migration 184 Fix: JSONB Extraction

**Before (unsafe):**
```sql
COALESCE((line->>'credit')::NUMERIC, 0)  -- Text extraction, can fail silently
```

**After (safe):**
```sql
COALESCE((line->'credit')::NUMERIC, 0)  -- JSONB numeric extraction
```

**Expected Behavior:**
- JSONB numeric values extracted correctly
- No NULL-to-0 coercion from failed text extraction
- ✅ Should work correctly

### Balance Validation

**Pre-INSERT validation (line 86-88):**
- Validates balance from `p_lines` JSONB
- Should catch imbalances before any INSERTs

**Expected:** If `p_lines` is balanced, validation passes.

---

## Summary of Theoretical Predictions

### What Should Work (if trigger semantics are correct):
1. ✅ JSONB extraction (migration 184) - safe numeric extraction
2. ✅ Direct revenue credit calculation (migration 183 line 379) - eliminates variable state issues
3. ✅ Pre-INSERT balance validation - catches issues early

### What Might Not Work:
1. ❓ Statement-level trigger with loop INSERTs - may still fire per INSERT
2. ❓ TEST C NULL tax_lines - unclear which error handling is active

### Critical Unknown:
**Does PostgreSQL statement-level trigger fire once per INSERT statement, or once per transaction?**

**If once per statement:**
- Loop-based INSERTs will fire trigger after each INSERT
- First insert creates imbalance, trigger fails
- **Migration 185 fix may not be sufficient**

**If once per transaction (unlikely but possible):**
- Trigger fires once after all INSERTs complete
- **Migration 185 fix is sufficient**

**This MUST be verified empirically** - see `test_trigger_semantics()` function in `VERIFICATION_SCRIPTS.sql`.

---

## Recommendations for Verification

1. **Run `test_trigger_semantics()` first** - This determines if migration 185 fix is effective
2. **If trigger fires per-INSERT:** Need alternative solution (e.g., batch INSERT or deferred validation)
3. **If trigger fires once:** Migration 185 is sufficient, proceed with other verifications
4. **Run `verification_test_runner()`** - Captures all evidence needed
5. **Compare theoretical vs actual** - Identify any discrepancies

---

**Analysis Complete** - Awaiting empirical verification results
