# Verification Pass Instructions

**Objective:** Verify whether migrations 184 + 185 fully resolve the issue before proposing new fixes.

---

## Files Created

1. **`VERIFICATION_SCRIPTS.sql`** - SQL scripts to run in your database
2. **`VERIFICATION_PASS_REPORT.md`** - Template to fill in with results
3. **`VERIFICATION_THEORETICAL_ANALYSIS.md`** - Code analysis predicting expected behavior

---

## Step-by-Step Verification Process

### Step 1: Run Trigger Semantics Test

**Purpose:** Determine if statement-level trigger fires once or per-INSERT

**Action:** Execute in your database:
```sql
SELECT * FROM test_trigger_semantics();
```

**What to capture:**
- Did both inserts succeed?
- What was the trigger fire count?
- Was balance validated correctly?

**Fill in:** `VERIFICATION_PASS_REPORT.md` → "Trigger Semantics Evidence" section

**Critical:** This determines whether migration 185 fix actually works with loop-based INSERTs.

---

### Step 2: Run Enhanced Test Runner

**Purpose:** Execute TEST A, B, C and capture all evidence

**Action:** Execute in your database:
```sql
SELECT * FROM verification_test_runner();
```

**What to capture:**
- Pass/fail for each test
- Error source (post_journal_entry, trigger, post_sale_to_ledger)
- Exact error messages
- journal_lines JSONB payloads
- Totals at all three layers (intent, JSONB, table)

**Fill in:** `VERIFICATION_PASS_REPORT.md` → Multiple sections:
- "Test Results on Current Code"
- "Captured journal_lines Payloads"
- "Totals Comparison"

---

### Step 3: Verify Migration Status

**Action:** Execute in your database:
```sql
-- Check trigger definition
SELECT trigger_name, event_manipulation, action_timing, action_orientation
FROM information_schema.triggers
WHERE event_object_table = 'journal_entry_lines'
  AND trigger_name = 'trigger_enforce_double_entry_balance';

-- Check function definition
SELECT p.oid, p.proname
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'post_journal_entry'
  AND n.nspname = 'public'
ORDER BY p.oid DESC
LIMIT 1;
```

**What to verify:**
- Trigger is `FOR EACH STATEMENT` (not `FOR EACH ROW`)
- Function OID matches migration 184

**Fill in:** `VERIFICATION_PASS_REPORT.md` → "Test Execution Environment"

---

### Step 4: Analyze Results

**Compare:**
1. Theoretical predictions (`VERIFICATION_THEORETICAL_ANALYSIS.md`)
2. Actual results (from Step 2)

**Identify:**
- Which tests pass/fail
- Where mismatches occur (intent vs JSONB vs table)
- Whether trigger semantics work as expected
- Which open problems are real vs theoretical

**Fill in:** `VERIFICATION_PASS_REPORT.md` → 
- "Confirmed Open Problems"
- "Problems Now Proven Resolved"
- "Summary"

---

## Critical Questions to Answer

After running all verification scripts, you should be able to answer:

1. ✅ **Does statement-level trigger work with loop INSERTs?**
   - Answer from Step 1

2. ✅ **Do TEST A/B/C pass with current code?**
   - Answer from Step 2

3. ✅ **Where do mismatches occur (if any)?**
   - Intent ≠ JSONB → Problem in `post_sale_to_ledger()`
   - JSONB ≠ Table → Problem in `post_journal_entry()` INSERT
   - Intent ≠ Table → Problem in both

4. ✅ **Which open problems are real vs theoretical?**
   - Variable state dependencies
   - Tax parsing complexity
   - Trigger redundancy
   - Loop-based INSERT interaction

---

## Expected Outcomes

### Scenario 1: All Tests Pass
- **Conclusion:** Migrations 184 + 185 fully resolve the issue
- **Action:** Proceed with cleanup only (remove debug logging)

### Scenario 2: Tests Fail, Trigger Semantics Problem
- **Conclusion:** Migration 185 fix insufficient (statement-level trigger still fires per-INSERT)
- **Action:** Need alternative solution (batch INSERT or deferred constraint)

### Scenario 3: Tests Fail, Other Issues
- **Conclusion:** Additional problems exist beyond migrations 184 + 185
- **Action:** Surgical fixes based on identified mismatch locations

---

## Next Steps After Verification

Once verification is complete:

1. Fill in `VERIFICATION_PASS_REPORT.md` completely
2. Review theoretical vs actual results
3. Determine which open problems are real
4. Proceed to fix design phase (if needed) with complete evidence

---

**Ready to Begin Verification** - Run scripts in order and capture all evidence
