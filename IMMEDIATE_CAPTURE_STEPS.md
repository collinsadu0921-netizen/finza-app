# Immediate Steps: Capture journal_lines Payloads NOW

**Status:** Tests just ran - debug log should have entries  
**Action Required:** Run these queries IMMEDIATELY to capture evidence

---

## Step 1: Verify Debug Log Has Entries

**Run this first:**
```sql
-- Check if debug log has recent entries
SELECT 
  COUNT(*) as total_recent,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM retail_posting_debug_log
WHERE created_at >= NOW() - INTERVAL '10 minutes';
```

**Expected:** Should show 3+ entries (one per test)

---

## Step 2: Get Most Recent journal_lines JSONB

**Run this to see all recent entries:**
```sql
-- From QUICK_CAPTURE_AFTER_TESTS.sql - Option 2
SELECT
  sale_id,
  created_at,
  journal_lines::text AS journal_lines_text,
  debit_sum,
  credit_sum,
  line_count
FROM retail_posting_debug_log
WHERE created_at >= NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC
LIMIT 10;
```

**Capture:** The `journal_lines_text` for each entry (should be 3 entries for TEST A, B, C)

---

## Step 3: Find Test Entries by Description

**Run this to match test entries:**
```sql
-- From QUICK_CAPTURE_AFTER_TESTS.sql - Option 4
SELECT
  d.sale_id,
  s.description AS sale_description,
  d.created_at,
  d.journal_lines,
  d.debit_sum,
  d.credit_sum,
  d.credit_count,
  d.tax_shape
FROM retail_posting_debug_log d
JOIN sales s ON s.id = d.sale_id
WHERE d.created_at >= NOW() - INTERVAL '10 minutes'
  AND (
    s.description LIKE '%TEST%' 
    OR s.description LIKE '%Canonical%'
    OR s.description LIKE '%Parsed%'
    OR s.description LIKE '%NULL%'
  )
ORDER BY d.created_at DESC;
```

---

## Step 4: Detailed Line-by-Line Analysis

**For the most recent entry, run:**
```sql
-- From QUICK_CAPTURE_AFTER_TESTS.sql - Option 3
WITH recent_logs AS (
  SELECT 
    id,
    sale_id,
    journal_lines,
    created_at,
    debit_sum,
    credit_sum,
    line_count
  FROM retail_posting_debug_log
  WHERE created_at >= NOW() - INTERVAL '10 minutes'
    AND journal_lines IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 3
)
SELECT
  rl.sale_id,
  rl.created_at,
  rl.line_count,
  rl.debit_sum,
  rl.credit_sum,
  line_num.idx AS line_number,
  line_num.line->>'account_id' AS account_id,
  line_num.line->>'debit' AS debit,
  line_num.line->>'credit' AS credit,
  line_num.line->>'description' AS description
FROM recent_logs rl
CROSS JOIN LATERAL jsonb_array_elements(rl.journal_lines) WITH ORDINALITY AS line_num(line, idx)
ORDER BY rl.created_at DESC, line_num.idx;
```

---

## What to Look For

### For TEST A (Canonical):
- Should have 3-4 lines
- Line 1: Cash debit (100.00)
- Line 2: Revenue credit (83.34)
- Line 3: Tax credit (16.66)
- **Critical:** Are credits actually in the JSONB? Check `credit` values.

### For TEST B (Parsed only):
- Similar structure
- **Critical:** Why is credit_sum 116.66? Check individual line values.

### For TEST C (NULL):
- **Critical:** Does journal_lines exist? (Shouldn't if NULL validation works)
- If it exists, what was built?

---

## If Debug Log is Empty

**Check if logging code exists:**
```sql
-- From DIAGNOSTIC_DEBUG_LOG_CAPTURE.sql - Step 6
SELECT
  p.oid,
  p.proname,
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%INSERT INTO public.retail_posting_debug_log%' THEN '✅ HAS DEBUG LOGGING'
    ELSE '❌ NO DEBUG LOGGING'
  END AS logging_status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_sale_to_ledger'
ORDER BY p.oid DESC
LIMIT 1;
```

**If NO DEBUG LOGGING:** Function may have been overwritten by later migration.

---

## After Capturing

1. **Copy the exact `journal_lines` JSONB** for each test
2. **Update:** `FINAL_VERIFICATION_REPORT.md` → "Captured journal_lines" section
3. **Answer:**
   - Are credits IN the JSONB but lost during INSERT?
   - Or are credits MISSING from JSONB construction?
   - Why does TEST B show 116.66?

---

**Run these queries NOW while the data is fresh!**
