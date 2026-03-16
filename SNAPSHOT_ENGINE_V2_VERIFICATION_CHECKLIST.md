# ✅ SNAPSHOT ENGINE V2 — VERIFICATION CHECKLIST

**Migration:** `247_snapshot_engine_v2_stale_aware.sql`  
**Date:** 2026-02-01

---

## VERIFICATION SCENARIOS

### Scenario 1: Posting Expense Causes Snapshot Staleness

**Precondition:** Snapshot must exist for the period. If no snapshot exists, first generate one by loading Trial Balance report for that period.

**Steps:**
1. Identify a period with existing snapshot (or generate one first)
2. Create expense in that period
3. Verify snapshot marked stale

**SQL Verification:**

```sql
-- 1. Find period with snapshot (or generate one if missing)
SELECT period_id, business_id, is_stale, last_rebuilt_at, last_ledger_change_at
FROM trial_balance_snapshots
WHERE is_stale = FALSE
LIMIT 1;

-- If no snapshot exists, generate one by calling:
-- GET /api/accounting/reports/trial-balance?business_id=<business_id>&period_start=<period_start>
-- Then re-run the query above

-- Note: period_id and business_id for next steps

-- 2. Create expense via API or:
-- INSERT INTO expenses (business_id, amount, total, date, ...) VALUES (...);

-- 3. Verify snapshot marked stale
SELECT period_id, is_stale, last_ledger_change_at, stale_reason
FROM trial_balance_snapshots
WHERE period_id = '<period_id_from_step1>';

-- Expected: is_stale = TRUE, last_ledger_change_at updated, stale_reason = 'journal_entry_insert'
```

**Pass Criteria:** ✅ Snapshot `is_stale` flips to `TRUE` after expense creation

---

### Scenario 2: Report Load Rebuilds Stale Snapshot

**Steps:**
1. Ensure snapshot is stale (from Scenario 1 or manually set)
2. Load Trial Balance report for that period
3. Verify snapshot refreshed

**SQL Verification:**

```sql
-- 1. Manually mark snapshot stale (if needed)
UPDATE trial_balance_snapshots
SET is_stale = TRUE, stale_reason = 'manual_test'
WHERE period_id = '<period_id>';

-- Record timestamp before report load
SELECT last_rebuilt_at, is_stale
FROM trial_balance_snapshots
WHERE period_id = '<period_id>';

-- 2. Load report via API: GET /api/accounting/reports/trial-balance?business_id=<business_id>&period_start=<period_start>

-- 3. Verify snapshot refreshed
SELECT period_id, is_stale, last_rebuilt_at, stale_reason
FROM trial_balance_snapshots
WHERE period_id = '<period_id>';

-- Expected: is_stale = FALSE, last_rebuilt_at updated (newer than before), stale_reason = NULL
```

**Pass Criteria:** ✅ Snapshot `is_stale` flips to `FALSE` and `last_rebuilt_at` updates after report load

---

### Scenario 3: Concurrency Protection (Lock Prevents Duplicate Rebuilds)

**Steps:**
1. Mark snapshot stale
2. Record initial timestamp
3. Hit report endpoint 10x concurrently
4. Verify only one rebuild occurred (timestamp changes exactly once)

**SQL Verification:**

```sql
-- 1. Mark snapshot stale
UPDATE trial_balance_snapshots
SET is_stale = TRUE, stale_reason = 'concurrency_test'
WHERE period_id = '<period_id>';

-- 2. Record initial state
SELECT 
  period_id, 
  last_rebuilt_at as initial_rebuild_at,
  generated_at as initial_generated_at,
  is_stale
FROM trial_balance_snapshots
WHERE period_id = '<period_id>';

-- 3. Hit report endpoint concurrently (use curl or load test tool)
-- Example: for i in {1..10}; do curl "http://localhost:3000/api/accounting/reports/trial-balance?business_id=<business_id>&period_start=<period_start>" & done
-- Wait for all requests to complete

-- 4. Verify only one rebuild occurred (timestamp-based verification)
SELECT 
  period_id, 
  last_rebuilt_at,
  generated_at,
  is_stale,
  -- Verify timestamps match (rebuild updates both)
  CASE 
    WHEN last_rebuilt_at = generated_at THEN 'MATCH'
    ELSE 'MISMATCH'
  END as timestamp_consistency
FROM trial_balance_snapshots
WHERE period_id = '<period_id>';

-- Expected: 
-- - last_rebuilt_at changed exactly once (single timestamp)
-- - generated_at matches last_rebuilt_at (consistency)
-- - is_stale = FALSE (marked fresh)
-- - Timestamps are newer than initial_rebuild_at from step 2
```

**Pass Criteria:** ✅ `last_rebuilt_at` changes exactly once, `generated_at` matches rebuild timestamp, `is_stale` ends `FALSE`

---

### Scenario 4: Posting When Snapshot Does Not Exist

**Steps:**
1. Confirm no snapshot exists for the period
2. Post expense/payment/invoice in that period
3. Call Trial Balance report
4. Confirm snapshot created automatically
5. Confirm snapshot marked fresh

**SQL Verification:**

```sql
-- 1. Confirm no snapshot exists for period
SELECT *
FROM trial_balance_snapshots
WHERE period_id = '<period_id>';

-- Expected: 0 rows (no snapshot exists)

-- 2. Post expense/payment/invoice via API
-- This will trigger invalidation, but snapshot doesn't exist yet (no-op)

-- 3. Call Trial Balance report
-- GET /api/accounting/reports/trial-balance?business_id=<business_id>&period_start=<period_start>

-- 4. Verify snapshot created automatically
SELECT 
  period_id,
  business_id,
  is_stale,
  last_rebuilt_at,
  generated_at,
  stale_reason
FROM trial_balance_snapshots
WHERE period_id = '<period_id>';

-- Expected after report call:
-- - Row exists (snapshot created)
-- - is_stale = FALSE (marked fresh)
-- - last_rebuilt_at NOT NULL (rebuild timestamp set)
-- - generated_at NOT NULL (generation timestamp set)
-- - stale_reason IS NULL (no stale reason)
```

**Pass Criteria:** ✅ Snapshot created automatically on first report call, marked fresh (`is_stale = FALSE`)

---

### Scenario 5: Invalidation Safety (Documentation Only)

**Note:** The invalidation trigger (`trigger_invalidate_snapshot_on_journal_entry`) is wrapped in an exception handler that prevents aborting journal entry posting. This is verified by code review of migration `247_snapshot_engine_v2_stale_aware.sql`.

**Safety Guarantee:**
- Trigger function `invalidate_snapshot_on_journal_entry` uses `EXCEPTION WHEN OTHERS` block
- If invalidation fails, trigger logs warning but returns `NEW` (allows insert to proceed)
- Journal entry posting cannot be aborted by snapshot invalidation failures

**Verification:** Code review confirms exception handling in trigger function.

**Pass Criteria:** ✅ Exception handler present in trigger function (verified by code review)

---

### Scenario 6: Multi-Tenant Isolation

**Steps:**
1. Business A posts entry
2. Verify Business B snapshots not affected

**SQL Verification:**

```sql
-- 1. Get two different businesses
SELECT id FROM businesses LIMIT 2;
-- Note: business_a_id and business_b_id

-- 2. Get periods for each business
SELECT id, business_id, period_start
FROM accounting_periods
WHERE business_id IN ('<business_a_id>', '<business_b_id>')
ORDER BY business_id, period_start;

-- 3. Create journal entry for Business A
-- (via API or direct INSERT)

-- 4. Verify Business A snapshot marked stale
SELECT period_id, business_id, is_stale, last_ledger_change_at
FROM trial_balance_snapshots
WHERE business_id = '<business_a_id>'
  AND period_id = '<business_a_period_id>';

-- Expected: Business A snapshot is_stale = TRUE

-- 5. Verify Business B snapshots unchanged
SELECT period_id, business_id, is_stale, last_ledger_change_at
FROM trial_balance_snapshots
WHERE business_id = '<business_b_id>'
  AND period_id = '<business_b_period_id>';

-- Expected: Business B snapshot unchanged (is_stale still FALSE or NULL)
```

**Pass Criteria:** ✅ Only Business A snapshot marked stale; Business B snapshots unaffected

---

## QUICK VERIFICATION QUERIES

### Check Snapshot Staleness Status

```sql
SELECT 
  tbs.period_id,
  tbs.business_id,
  tbs.is_stale,
  tbs.last_rebuilt_at,
  tbs.last_ledger_change_at,
  tbs.stale_reason,
  tbs.generated_at,
  ap.period_start,
  ap.period_end,
  ap.status
FROM trial_balance_snapshots tbs
JOIN accounting_periods ap ON ap.id = tbs.period_id
WHERE tbs.business_id = '<business_id>'
ORDER BY ap.period_start DESC;
```

### Check Trigger Exists

```sql
SELECT 
  tgname,
  tgrelid::regclass,
  tgenabled
FROM pg_trigger
WHERE tgname = 'trigger_invalidate_snapshot_on_journal_entry';
```

### Check Function Exists

```sql
SELECT 
  proname,
  pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    'mark_trial_balance_snapshot_stale',
    'invalidate_snapshot_on_journal_entry',
    'get_trial_balance_from_snapshot',
    'generate_trial_balance'
  );
```

### Check Columns Added

```sql
SELECT 
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'trial_balance_snapshots'
  AND column_name IN ('is_stale', 'last_rebuilt_at', 'last_ledger_change_at', 'stale_reason');
```

---

## ROLLBACK VERIFICATION

If issues occur, verify rollback:

```sql
-- 1. Disable trigger
DROP TRIGGER IF EXISTS trigger_invalidate_snapshot_on_journal_entry ON journal_entries;

-- 2. Verify trigger disabled
SELECT tgname FROM pg_trigger WHERE tgname = 'trigger_invalidate_snapshot_on_journal_entry';
-- Expected: No rows

-- 3. Verify columns still exist (harmless)
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'trial_balance_snapshots' 
  AND column_name = 'is_stale';
-- Expected: Column exists (backward compatible)
```

---

## PRODUCTION MONITORING

### Monitor Snapshot Staleness Rate

```sql
SELECT 
  COUNT(*) FILTER (WHERE is_stale = TRUE) as stale_count,
  COUNT(*) FILTER (WHERE is_stale = FALSE) as fresh_count,
  COUNT(*) as total_snapshots
FROM trial_balance_snapshots
WHERE business_id = '<business_id>';
```

### Monitor Rebuild Frequency

```sql
SELECT 
  tbs.period_id,
  tbs.last_rebuilt_at,
  tbs.last_ledger_change_at,
  tbs.is_stale,
  tbs.stale_reason,
  ap.period_start,
  ap.period_end
FROM trial_balance_snapshots tbs
JOIN accounting_periods ap ON ap.id = tbs.period_id
WHERE tbs.business_id = '<business_id>'
  AND tbs.last_rebuilt_at IS NOT NULL
ORDER BY tbs.last_rebuilt_at DESC
LIMIT 10;
```

---

**VERIFICATION COMPLETE**
