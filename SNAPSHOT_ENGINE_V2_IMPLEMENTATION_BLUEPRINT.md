# 🏗️ SNAPSHOT ENGINE V2 — IMPLEMENTATION BLUEPRINT

**Date:** 2026-02-01  
**Purpose:** Implementation plan for stale-aware, lock-safe, non-blocking snapshot system  
**Mode:** IMPLEMENTATION PLAN ONLY (no code dumps)

---

## EXECUTIVE SUMMARY

**Problem:** Expenses/payments/invoices not reflecting in reports due to stale snapshots.

**Solution:** Snapshot Engine v2 = 3 pieces:
1. **Invalidate:** Mark period snapshot as stale when ledger changes (cheap, O(1))
2. **Rebuild:** Regenerate snapshot if missing OR stale (on report request)
3. **Lock:** Prevent concurrent rebuilds for same period (advisory lock)

**Non-Negotiables:**
- ✅ Posting remains fast and atomic (no heavy aggregation in triggers)
- ✅ Ledger remains immutable
- ✅ Multi-tenant isolation (all queries filter by business_id)
- ✅ Reporting remains deterministic
- ✅ No silent cross-business reads

---

## IMPLEMENTATION STEPS

### STEP 1 — Extend `trial_balance_snapshots` Schema

**Migration File:** `supabase/migrations/247_snapshot_engine_v2_stale_metadata.sql`

**Changes:**
- Add `is_stale BOOLEAN NOT NULL DEFAULT TRUE`
- Add `last_rebuilt_at TIMESTAMPTZ`
- Add `last_ledger_change_at TIMESTAMPTZ`
- Add `stale_reason TEXT` (optional, for debugging)

**Acceptance Criteria:**
- Existing snapshots default to `is_stale = TRUE` (forces one rebuild per period after deploy)
- All new columns are nullable except `is_stale` (to allow gradual migration)
- No breaking changes to existing queries

**SQL Pattern:**
```sql
ALTER TABLE trial_balance_snapshots
  ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_rebuilt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_ledger_change_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stale_reason TEXT;

-- Set existing snapshots to stale (forces refresh)
UPDATE trial_balance_snapshots SET is_stale = TRUE WHERE is_stale IS NULL;
```

---

### STEP 2 — Add Invalidation Function

**Function:** `mark_trial_balance_snapshot_stale(p_business_id UUID, p_posting_date DATE, p_reason TEXT)`

**Behavior:**
1. Resolve accounting period for `p_posting_date` (use `ensure_accounting_period` or `find_period_for_date`)
2. Update snapshot row for that period if it exists:
   - Set `is_stale = TRUE`
   - Set `last_ledger_change_at = NOW()`
   - Set `stale_reason = p_reason`
3. If snapshot row doesn't exist → do nothing (report will generate it later)

**Requirements:**
- **O(1) operation:** No aggregation, no joins over big tables
- **Business-scoped:** Filter by `business_id` and `period_id`
- **Idempotent:** Safe to call multiple times

**SQL Pattern:**
```sql
CREATE OR REPLACE FUNCTION mark_trial_balance_snapshot_stale(
  p_business_id UUID,
  p_posting_date DATE,
  p_reason TEXT DEFAULT 'journal_entry_insert'
)
RETURNS VOID AS $$
DECLARE
  v_period_id UUID;
BEGIN
  -- Resolve period for posting date
  SELECT id INTO v_period_id
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND p_posting_date >= period_start
    AND p_posting_date <= period_end
  LIMIT 1;

  -- If period found and snapshot exists, mark stale
  IF v_period_id IS NOT NULL THEN
    UPDATE trial_balance_snapshots
    SET 
      is_stale = TRUE,
      last_ledger_change_at = NOW(),
      stale_reason = p_reason
    WHERE period_id = v_period_id
      AND business_id = p_business_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
```

---

### STEP 3 — Add Invalidation Trigger

**Trigger:** `trigger_invalidate_snapshot_on_journal_entry`

**Target:** `journal_entries` table  
**Timing:** `AFTER INSERT`  
**Action:** Call `mark_trial_balance_snapshot_stale(NEW.business_id, NEW.date, 'journal_entry_insert')`

**Requirements:**
- **Minimal:** No joins, no aggregation, no snapshot generation
- **Fast:** Should add <1ms to posting transaction
- **Safe:** If invalidation fails, posting should still succeed (or fail gracefully)

**SQL Pattern:**
```sql
CREATE OR REPLACE FUNCTION invalidate_snapshot_on_journal_entry()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM mark_trial_balance_snapshot_stale(
    NEW.business_id,
    NEW.date,
    'journal_entry_insert'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_invalidate_snapshot_on_journal_entry ON journal_entries;
CREATE TRIGGER trigger_invalidate_snapshot_on_journal_entry
  AFTER INSERT ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION invalidate_snapshot_on_journal_entry();
```

---

### STEP 4 — Upgrade `get_trial_balance_from_snapshot`

**Current Behavior:**
- If snapshot exists → return it
- Else → generate then return

**New Behavior:**
- Fetch snapshot row for `p_period_id`
- If missing → generate
- If exists AND `is_stale = TRUE` → generate
- Else → return cached snapshot

**SQL Pattern:**
```sql
CREATE OR REPLACE FUNCTION get_trial_balance_from_snapshot(
  p_period_id UUID
)
RETURNS TABLE (...) AS $$
DECLARE
  snapshot_record trial_balance_snapshots;
BEGIN
  -- Get snapshot
  SELECT * INTO snapshot_record
  FROM trial_balance_snapshots
  WHERE period_id = p_period_id;

  -- If snapshot doesn't exist OR is stale, regenerate
  IF NOT FOUND OR snapshot_record.is_stale = TRUE THEN
    PERFORM generate_trial_balance(p_period_id, NULL);
    
    SELECT * INTO snapshot_record
    FROM trial_balance_snapshots
    WHERE period_id = p_period_id;
  END IF;

  -- Return accounts from snapshot
  ...
END;
$$ LANGUAGE plpgsql;
```

---

### STEP 5 — Add Concurrency Protection

**Location:** `generate_trial_balance` function OR wrapper

**Mechanism:** `pg_advisory_xact_lock` on `period_id`

**Behavior:**
- Acquire lock before snapshot generation
- Other concurrent requests wait for lock
- After lock release, they see fresh snapshot (no rebuild needed)

**SQL Pattern:**
```sql
CREATE OR REPLACE FUNCTION generate_trial_balance(
  p_period_id UUID,
  p_generated_by UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  period_record accounting_periods;
  lock_key BIGINT;
BEGIN
  -- Acquire advisory lock for this period_id
  lock_key := hashtext(p_period_id::TEXT);
  PERFORM pg_advisory_xact_lock(lock_key);

  -- Re-check snapshot after lock (another transaction may have generated it)
  SELECT * INTO snapshot_record
  FROM trial_balance_snapshots
  WHERE period_id = p_period_id
    AND is_stale = FALSE;

  IF FOUND THEN
    -- Another transaction already generated fresh snapshot
    RETURN snapshot_json_from_record(snapshot_record);
  END IF;

  -- Generate snapshot (existing logic)
  ...
  
  -- Mark snapshot as fresh
  UPDATE trial_balance_snapshots
  SET 
    is_stale = FALSE,
    last_rebuilt_at = NOW(),
    stale_reason = NULL
  WHERE period_id = p_period_id;

  RETURN snapshot_json;
END;
$$ LANGUAGE plpgsql;
```

---

### STEP 6 — Mark Snapshot Fresh on Rebuild

**Location:** End of `generate_trial_balance` function

**Behavior:**
- After successful snapshot upsert, set `is_stale = FALSE`
- Set `last_rebuilt_at = NOW()`
- Optionally clear `stale_reason` (or preserve for debugging)

**SQL Pattern:**
```sql
-- In generate_trial_balance, after INSERT ... ON CONFLICT DO UPDATE:
UPDATE trial_balance_snapshots
SET 
  is_stale = FALSE,
  last_rebuilt_at = NOW(),
  stale_reason = NULL
WHERE period_id = p_period_id;
```

**Note:** This can be combined with the `ON CONFLICT DO UPDATE` clause:

```sql
INSERT INTO trial_balance_snapshots (...)
VALUES (...)
ON CONFLICT (period_id) DO UPDATE
SET 
  generated_at = NOW(),
  generated_by = EXCLUDED.generated_by,
  total_debits = EXCLUDED.total_debits,
  total_credits = EXCLUDED.total_credits,
  account_count = EXCLUDED.account_count,
  is_balanced = EXCLUDED.is_balanced,
  balance_difference = EXCLUDED.balance_difference,
  snapshot_data = EXCLUDED.snapshot_data,
  is_stale = FALSE,  -- Mark fresh
  last_rebuilt_at = NOW(),  -- Update rebuild timestamp
  stale_reason = NULL;  -- Clear stale reason
```

---

## VERIFICATION PLAN

### Scenario 1 — Expense Appears in Reports

**Steps:**
1. Create expense (dated today)
2. Confirm journal entry exists: `SELECT * FROM journal_entries WHERE reference_type = 'expense' AND reference_id = '<expense_id>'`
3. Confirm snapshot marked stale: `SELECT is_stale, last_ledger_change_at FROM trial_balance_snapshots WHERE period_id = '<period_id>'`
4. Open Trial Balance for correct period
5. Confirm snapshot refreshed: `SELECT is_stale, last_rebuilt_at FROM trial_balance_snapshots WHERE period_id = '<period_id>'`
6. Confirm expense appears in report

**Expected:**
- Snapshot marked stale after expense creation
- Snapshot regenerated on report request
- Expense appears in report

---

### Scenario 2 — Expense Created After Snapshot Exists

**Steps:**
1. Open Trial Balance first (snapshot created, `is_stale = FALSE`)
2. Create new expense in same period
3. Confirm snapshot marked stale: `SELECT is_stale FROM trial_balance_snapshots WHERE period_id = '<period_id>'`
4. Open Trial Balance again
5. Confirm snapshot regenerated: `SELECT last_rebuilt_at FROM trial_balance_snapshots WHERE period_id = '<period_id>'`
6. Confirm expense appears in report

**Expected:**
- Trigger marks snapshot stale
- Report rebuilds once and includes new entry

---

### Scenario 3 — Concurrent Requests

**Steps:**
1. Delete snapshot for period (or mark stale)
2. Hit report endpoint 10x concurrently (use `curl` or load test tool)
3. Check database logs for `generate_trial_balance` calls
4. Confirm only one rebuild occurred: `SELECT COUNT(*) FROM pg_stat_statements WHERE query LIKE '%generate_trial_balance%'`

**Expected:**
- Only one rebuild runs (others wait/reuse)
- No deadlocks
- No duplicated heavy work

---

### Scenario 4 — Cross-Period Correctness

**Steps:**
1. Create expense dated last month
2. Confirm invalidation targets correct period: `SELECT period_id, is_stale FROM trial_balance_snapshots WHERE period_id IN (SELECT id FROM accounting_periods WHERE period_start = '<last_month>')`
3. Open current month report (should not include expense)
4. Open last month report (should include expense)

**Expected:**
- Invalidation targets correct period by `journal_entries.date`
- Reports show correct data per period

---

### Scenario 5 — Multi-Tenant Isolation

**Steps:**
1. Business A posts entry
2. Confirm Business B snapshots not marked stale: `SELECT COUNT(*) FROM trial_balance_snapshots WHERE business_id = '<business_b>' AND is_stale = TRUE`
3. Confirm Business A snapshot marked stale: `SELECT is_stale FROM trial_balance_snapshots WHERE business_id = '<business_a>' AND period_id = '<period_id>'`

**Expected:**
- Invalidation only affects same `business_id`
- No cross-tenant contamination

---

## VERIFICATION QUERIES

### Query 1 — Snapshot Staleness Toggle

```sql
-- Before expense creation
SELECT period_id, is_stale, last_ledger_change_at, last_rebuilt_at
FROM trial_balance_snapshots
WHERE period_id = '<period_id>';

-- Create expense (via API or direct INSERT)

-- After expense creation (check trigger fired)
SELECT period_id, is_stale, last_ledger_change_at, last_rebuilt_at
FROM trial_balance_snapshots
WHERE period_id = '<period_id>';

-- Expected: is_stale = TRUE, last_ledger_change_at updated
```

### Query 2 — Snapshot Refresh on Report Call

```sql
-- Before report call
SELECT period_id, is_stale, last_rebuilt_at
FROM trial_balance_snapshots
WHERE period_id = '<period_id>';

-- Call report API endpoint

-- After report call
SELECT period_id, is_stale, last_rebuilt_at
FROM trial_balance_snapshots
WHERE period_id = '<period_id>';

-- Expected: is_stale = FALSE, last_rebuilt_at updated
```

### Query 3 — Advisory Lock Prevents Duplicate Rebuilds

```sql
-- Check for concurrent generate_trial_balance calls
SELECT 
  query,
  calls,
  total_exec_time,
  mean_exec_time
FROM pg_stat_statements
WHERE query LIKE '%generate_trial_balance%'
ORDER BY calls DESC;

-- During concurrent load test, expect:
-- - Only one generate_trial_balance call per period
-- - Other requests wait for lock (no duplicate rebuilds)
```

---

## ROLLBACK PLAN

**If Issues Occur:**

1. **Disable Trigger:**
   ```sql
   DROP TRIGGER IF EXISTS trigger_invalidate_snapshot_on_journal_entry ON journal_entries;
   ```

2. **Leave Columns Harmless:**
   - New columns are nullable (except `is_stale` with default)
   - Existing queries continue to work
   - Snapshots default to stale (forces refresh, but safe)

3. **Remove Locking (if causes issues):**
   ```sql
   -- Remove advisory lock from generate_trial_balance
   -- Keep stale mechanism (less efficient but safe)
   ```

---

## WHY THIS FIXES THE BUG

**Current Problem:** Ledger is correct but snapshots are stale.

**This Design Guarantees:**
- ✅ Any new ledger entry marks period snapshot stale (cheap, O(1))
- ✅ Next report call refreshes snapshot safely (with locking)
- ✅ Concurrency doesn't create rebuild storms (advisory lock)
- ✅ Posting path stays fast (no heavy aggregation in triggers)

**Result:** Expenses/payments/invoices appear in reports immediately after creation (on next report request).

---

## IMPLEMENTATION ORDER

1. **Prompt 1:** Implement schema + invalidation (DB only)
   - Add columns to `trial_balance_snapshots`
   - Create `mark_trial_balance_snapshot_stale` function
   - Create `trigger_invalidate_snapshot_on_journal_entry` trigger

2. **Prompt 2:** Implement stale-aware snapshot retrieval + locking
   - Update `get_trial_balance_from_snapshot` to check `is_stale`
   - Add advisory lock to `generate_trial_balance`
   - Mark snapshot fresh after rebuild

3. **Prompt 3:** Add verification queries + test plan
   - Provide SQL verification queries
   - Provide test checklist
   - Document expected behavior

---

## DONE — READY FOR IMPLEMENTATION

**Next Steps:**
1. Execute Prompt 1 (schema + invalidation)
2. Execute Prompt 2 (stale-aware retrieval + locking)
3. Execute Prompt 3 (verification queries)
4. Run verification scenarios
5. Monitor performance in production

---

**BLUEPRINT COMPLETE**
