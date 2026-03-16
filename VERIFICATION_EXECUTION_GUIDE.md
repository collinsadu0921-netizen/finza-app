# Verification Execution Guide: Close Remaining Gaps

**Purpose:** Execute the final verification queries and populate the report with definitive evidence.

---

## Current Status

✅ **Migration 184: CONFIRMED APPLIED**
- Evidence: INSERT loop uses `(line->'debit')::NUMERIC` (safe extraction)

❓ **Migration 185: PENDING VERIFICATION**
- Need to verify trigger definition

❓ **Trigger Runtime Behavior: PENDING VERIFICATION**
- Need to run trigger semantics test

❓ **TEST A/B/C Results: PENDING VERIFICATION**
- Need to execute test suite

---

## Execution Steps

### Step 1: Verify Trigger Definition (Migration 185)

**Execute:**
```sql
SELECT
  tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname = 'journal_entry_lines'
  AND NOT t.tgisinternal
ORDER BY tgname;
```

**Answer these questions:**
1. Is the balance trigger `FOR EACH STATEMENT` ✅ or `FOR EACH ROW` ❌?
2. Is there more than one balance-related trigger?
3. Is any legacy trigger still present?

**Document in:** `FINAL_VERIFICATION_REPORT.md` → "Active Triggers on journal_entry_lines"

---

### Step 2: Complete Trigger Semantics Test

**Execute:**
```sql
SELECT * FROM test_trigger_semantics();
```

**Capture:**
- Full raw output (all NOTICE messages, all rows)
- Trigger fire count (1 or >1)
- Validation timing (after all inserts or after first insert)

**Document in:** `FINAL_VERIFICATION_REPORT.md` → "Trigger Semantics Test — Evidence"

---

### Step 3: Run TEST A / B / C

**Execute:**
```sql
SELECT * FROM test_retail_ledger_null_credit_fix();
```

**OR if verification_test_runner exists:**
```sql
SELECT * FROM verification_test_runner();
```

**Capture:**
- Complete test results table
- Full raw output
- For each failure: exact error message, error source, journal_entry_id

**Document in:** `FINAL_VERIFICATION_REPORT.md` → "Final TEST A / B / C Results"

---

### Step 4: Capture journal_lines for Failures (Only if needed)

**If any test failed, execute:**
```sql
SELECT
  id,
  created_at,
  sale_id,
  journal_lines,
  line_count,
  debit_sum,
  credit_sum,
  credit_count,
  tax_shape,
  note
FROM retail_posting_debug_log
WHERE created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 10;
```

**Document in:** `FINAL_VERIFICATION_REPORT.md` → "Captured journal_lines"

**Important:** Paste raw JSONB payload - NO editing, NO reformatting.

---

### Step 5: Verify Balance Validation Loop (Bonus)

**Execute the DO block from:** `FINAL_VERIFICATION_QUERIES.sql` (Section: "BONUS: Verify Balance Validation Loop")

**Document in:** `FINAL_VERIFICATION_REPORT.md` → "Balance Validation Loop Verification"

---

## All Queries in One Place

All queries are consolidated in: **`FINAL_VERIFICATION_QUERIES.sql`**

Run each section sequentially and paste results into: **`FINAL_VERIFICATION_REPORT.md`**

---

## Report Template

Use: **`FINAL_VERIFICATION_REPORT.md`**

Fill in each section with:
- ✅ Raw output (no editing)
- ✅ Definitive answers (check boxes)
- ✅ No placeholders remaining

---

## Success Criteria

After completing verification, you must be able to say with certainty:

- ✅ Whether migration 185 is active or not
- ✅ Whether loop-based INSERT is safe in runtime
- ✅ Whether any remaining failures are:
  - Tax math issues
  - Payload construction issues
  - Or already resolved

**Only after this will we design one surgical fix (if needed).**