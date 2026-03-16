# 🔍 MIGRATION 247 — RELIABILITY AUDIT

**Date:** 2026-02-01  
**Migration:** `247_snapshot_engine_v2_stale_aware.sql`  
**Status:** ⚠️ **MOSTLY RELIABLE** with minor improvements recommended

---

## ✅ RELIABILITY STRENGTHS

### 1. Exception Handling
- ✅ **Trigger Safety:** `invalidate_snapshot_on_journal_entry` wrapped in `EXCEPTION WHEN OTHERS`
- ✅ **Posting Protection:** Journal entry insert cannot be aborted by invalidation failures
- ✅ **Warning Logging:** Failures logged but don't block posting

### 2. Concurrency Safety
- ✅ **Advisory Lock:** Uses `pg_advisory_xact_lock` (transaction-scoped, auto-released)
- ✅ **Double-Check Pattern:** Re-checks snapshot after acquiring lock (prevents duplicate rebuilds)
- ✅ **Idempotent:** Invalidation function is idempotent (safe to call multiple times)

### 3. Business Isolation
- ✅ **All Queries Filtered:** Every query filters by `business_id`
- ✅ **Period Scoped:** Invalidation targets correct period by `business_id + date`

### 4. Data Integrity
- ✅ **ON CONFLICT:** Uses `ON CONFLICT (period_id) DO UPDATE` (prevents duplicates)
- ✅ **Balance Check:** Enforces double-entry balance invariant
- ✅ **Fresh Marking:** Marks snapshot fresh after successful rebuild

---

## ⚠️ MINOR ISSUES (Non-Blocking)

### Issue 1: Inefficient UPDATE Statement

**Location:** Lines 30-32

```sql
UPDATE trial_balance_snapshots 
SET is_stale = TRUE 
WHERE is_stale IS NULL OR is_stale = FALSE;
```

**Problem:**
- `is_stale` is `NOT NULL DEFAULT TRUE` (line 24)
- `is_stale IS NULL` condition is always false
- Query scans all rows unnecessarily

**Impact:** Low — Only runs once during migration, but inefficient

**Recommendation:**
```sql
UPDATE trial_balance_snapshots 
SET is_stale = TRUE 
WHERE is_stale = FALSE;
```

---

### Issue 2: Lock Key Pattern Inconsistency

**Location:** Line 194-195

```sql
lock_key := hashtext(p_period_id::TEXT);
PERFORM pg_advisory_xact_lock(lock_key);
```

**Pattern in Other Migrations:**
- Migration 229: `pg_advisory_xact_lock(hashtext(business_id), hashtext(entity_id))`
- Migration 226: `pg_advisory_xact_lock(hashtext(business_id), hashtext(entity_id))`

**Current Pattern:**
- Single-parameter lock: `pg_advisory_xact_lock(hashtext(period_id))`

**Problem:**
- Inconsistent with codebase pattern
- Single-parameter lock has slightly higher collision risk (though still extremely low for UUIDs)

**Impact:** Low — UUID collisions are astronomically rare

**Recommendation (Optional):**
```sql
-- More consistent with codebase pattern
PERFORM pg_advisory_xact_lock(
  hashtext(p_period_id::TEXT),
  hashtext('trial_balance_snapshot'::TEXT)
);
```

**Note:** Current implementation is safe; this is a style consistency improvement only.

---

### Issue 3: Period Record Query Duplication

**Location:** Lines 206-208 (early return path)

```sql
IF FOUND THEN
  -- Another transaction already generated fresh snapshot while we waited for lock
  -- Get period record for period_start/period_end
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE id = p_period_id;
```

**Problem:**
- Period record is queried again later (line 229) if we don't return early
- Duplicate query in early return path

**Impact:** Very Low — Only one extra query in the happy path (when snapshot already exists)

**Recommendation:** Keep as-is (optimization not worth complexity)

---

## ✅ EDGE CASES HANDLED CORRECTLY

### Edge Case 1: Snapshot Doesn't Exist
- ✅ **Handled:** Invalidation function does nothing if snapshot doesn't exist (line 70)
- ✅ **Handled:** `get_trial_balance_from_snapshot` generates snapshot if missing (line 139)

### Edge Case 2: Period Doesn't Exist
- ✅ **Handled:** Invalidation function does nothing if period not found (line 62)
- ✅ **Handled:** `generate_trial_balance` raises exception if period not found (line 234)

### Edge Case 3: Concurrent Rebuilds
- ✅ **Handled:** Advisory lock prevents concurrent rebuilds (line 195)
- ✅ **Handled:** Double-check after lock prevents duplicate work (lines 198-226)

### Edge Case 4: Invalidation Failure
- ✅ **Handled:** Exception handler prevents aborting journal entry insert (lines 91-97)

### Edge Case 5: NULL Snapshot Record
- ✅ **Handled:** `IF NOT FOUND OR snapshot_record.is_stale = TRUE` short-circuits correctly (line 139)

---

## 🔒 TRANSACTION SAFETY

### Advisory Lock Scope
- ✅ **Transaction-Scoped:** `pg_advisory_xact_lock` auto-releases on commit/rollback
- ✅ **No Deadlock Risk:** Single lock per period (no lock ordering issues)
- ✅ **No Leak Risk:** Transaction-scoped locks cannot leak

### Trigger Transaction Safety
- ✅ **AFTER INSERT:** Trigger fires after insert succeeds (no rollback risk)
- ✅ **Exception Handler:** Failures don't rollback parent transaction

---

## 📊 PERFORMANCE CHARACTERISTICS

### Invalidation Function (`mark_trial_balance_snapshot_stale`)
- ✅ **O(1) Operation:** Single period lookup + single snapshot UPDATE
- ✅ **Index Usage:** Uses `accounting_periods` index on `(business_id, period_start, period_end)`
- ✅ **No Heavy Queries:** No aggregation, no joins over large tables

### Snapshot Generation (`generate_trial_balance`)
- ⚠️ **O(accounts × entries):** Scans ledger per account (expected behavior)
- ✅ **Index Usage:** Uses indexes on `journal_entries` and `journal_entry_lines`
- ✅ **Lock Protection:** Prevents duplicate rebuilds (saves resources)

---

## 🎯 RELIABILITY VERDICT

**Overall Status:** ✅ **RELIABLE** (with minor improvements recommended)

**Production Ready:** ✅ **YES**

**Critical Issues:** ❌ **NONE**

**Minor Issues:** ⚠️ **3** (all non-blocking, optimization-only)

**Recommendations:**
1. Fix UPDATE statement inefficiency (line 30-32)
2. Consider aligning lock pattern with codebase (optional)
3. Monitor performance in production (expected to be good)

---

## ✅ SAFETY GUARANTEES

- ✅ **Posting Never Aborts:** Exception handler prevents invalidation failures from blocking journal entries
- ✅ **No Data Loss:** All operations are idempotent and transactional
- ✅ **No Deadlocks:** Single lock per period, no lock ordering issues
- ✅ **Multi-Tenant Safe:** All queries filter by `business_id`
- ✅ **Backward Compatible:** New columns are nullable (except `is_stale` with safe default)

---

## 🚀 DEPLOYMENT RECOMMENDATION

**Status:** ✅ **SAFE TO DEPLOY**

**Pre-Deployment:**
1. Review UPDATE statement (line 30-32) — consider fixing inefficiency
2. Test in staging environment
3. Monitor snapshot staleness rates post-deploy

**Post-Deployment:**
1. Verify trigger exists: `SELECT * FROM pg_trigger WHERE tgname = 'trigger_invalidate_snapshot_on_journal_entry'`
2. Verify functions exist: Check all 4 functions are created
3. Monitor: Check snapshot staleness rates and rebuild frequency

---

**AUDIT COMPLETE**
