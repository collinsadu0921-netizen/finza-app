# Test Execution Guide
## Step 9.1 Batch F — Action 2: Execute Test Suites

**Workspace:** Accounting Workspace ONLY  
**Prereq:** Test DB configured and verified ✅  
**Rule:** No code changes. Execution + evidence only.

---

## OBJECTIVE

Run all **Batch F** test suites against the test database and capture results to determine PASS / FAIL.

---

## PRE-EXECUTION CHECKLIST

### 1. Environment Check

**Verify `.env.test` is configured:**

```bash
# Check if .env.test exists
ls -la .env.test  # Linux/Mac
dir .env.test     # Windows

# Verify test database connection
# Should point to test Supabase project, NOT dev/prod
```

**Required variables in `.env.test`:**
- `NEXT_PUBLIC_SUPABASE_URL` (test project URL)
- `SUPABASE_SERVICE_ROLE_KEY` (test project key)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (test project anon key)
- `TEST_FIRM_ID`
- `TEST_BUSINESS_ID`
- `TEST_PARTNER_USER_ID`
- `TEST_SENIOR_USER_ID`
- `TEST_JUNIOR_USER_ID`
- `TEST_OPEN_PERIOD_ID`
- `TEST_LOCKED_PERIOD_ID`

**Verify test runner points to test DB only:**
```bash
# Check environment
echo $NODE_ENV  # Should be 'test' when running tests
```

---

### 2. Test Database Verification

**Run verification script:**
```sql
-- In Supabase SQL Editor (test project)
-- Run: TEST_DATABASE_VERIFY.sql
-- Expected: All checks show ✅
```

**Quick verification:**
```sql
SELECT 
  'Firm' as check, COUNT(*) as count FROM accounting_firms WHERE name = 'Test Accounting Firm'
UNION ALL
SELECT 
  'Business', COUNT(*) FROM businesses WHERE name = 'Test Client Business'
UNION ALL
SELECT 
  'Firm Users', COUNT(*) FROM accounting_firm_users 
  WHERE firm_id = (SELECT id FROM accounting_firms WHERE name = 'Test Accounting Firm')
UNION ALL
SELECT 
  'Periods', COUNT(*) FROM accounting_periods 
  WHERE business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business');
-- All should return count = 1 (or 3 for users)
```

---

## EXECUTION ORDER (STRICT)

### A) Canonical Builder & Determinism

**Test File:** `lib/accounting/__tests__/openingBalanceImports.test.ts`

**Command:**
```bash
npm test -- lib/accounting/__tests__/openingBalanceImports.test.ts
# OR
pnpm test lib/accounting/__tests__/openingBalanceImports.test.ts
```

**Expected:** All tests pass (20+ test cases)
- Hash determinism
- Amount normalization
- Memo normalization
- Line ordering
- Payload validation

**Capture Results:**
- Test output
- Pass/fail count
- Any errors

---

### B) Draft Lifecycle

**Test File:** `app/api/accounting/opening-balances/__tests__/lifecycle.test.ts`

**Command:**
```bash
npm test -- app/api/accounting/opening-balances/__tests__/lifecycle.test.ts
```

**Expected:** All tests pass (14 test cases)
- Create draft
- Update draft
- Approve flow
- Status transitions

**Note:** These tests require test database connection. Ensure `.env.test` is loaded.

---

### C) Posting & Idempotency

**Test File:** `app/api/accounting/opening-balances/__tests__/posting-idempotency.test.ts`

**Command:**
```bash
npm test -- app/api/accounting/opening-balances/__tests__/posting-idempotency.test.ts
```

**Expected:** All tests pass (10 test cases)
- Post approved import
- Idempotency checks
- Concurrent safety
- Ledger linkage

---

### D) Duplicate Protection

**Test File:** `app/api/accounting/opening-balances/__tests__/duplicate-protection.test.ts`

**Command:**
```bash
npm test -- app/api/accounting/opening-balances/__tests__/duplicate-protection.test.ts
```

**Expected:** All tests pass (7 test cases)
- One-per-business enforcement
- Database constraints
- Posting duplicate checks

---

### E) Period Lock Enforcement

**Test File:** `app/api/accounting/opening-balances/__tests__/period-lock-enforcement.test.ts`

**Command:**
```bash
npm test -- app/api/accounting/opening-balances/__tests__/period-lock-enforcement.test.ts
```

**Expected:** All tests pass (7 test cases)
- Approve blocked if locked
- Post blocked if locked
- No partial ledger entries

---

### F) Authority Enforcement

**Test File:** `app/api/accounting/opening-balances/__tests__/authority-enforcement.test.ts`

**Command:**
```bash
npm test -- app/api/accounting/opening-balances/__tests__/authority-enforcement.test.ts
```

**Expected:** All tests pass (11 test cases)
- Partner-only approval
- Partner-only posting
- Engagement access checks
- No audit on failed attempts

---

### G) Audit Trail Integrity

**Test File:** `app/api/accounting/opening-balances/__tests__/audit-trail.test.ts`

**Command:**
```bash
npm test -- app/api/accounting/opening-balances/__tests__/audit-trail.test.ts
```

**Expected:** All tests pass (7 test cases)
- Creation audit
- Approval audit
- Posting audit
- Chronological integrity

---

## RUN ALL TESTS

**Single command to run all opening balance tests:**
```bash
npm test -- opening-balances
# OR
npm test -- openingBalance
```

**With coverage:**
```bash
npm test -- opening-balances --coverage
```

---

## CAPTURE RESULTS

### Test Output Format

For each test suite, capture:
1. **Test file name**
2. **Total tests**
3. **Passed count**
4. **Failed count**
5. **Skipped count** (if any)
6. **Execution time**
7. **Error messages** (if any)

### Example Output Template

```
========================================
Test Suite: Canonical Builder Determinism
File: lib/accounting/__tests__/openingBalanceImports.test.ts
========================================
Total: 20
Passed: 20
Failed: 0
Skipped: 0
Time: 2.5s
Status: ✅ PASS
========================================
```

---

## HANDLING TEST FAILURES

### If Tests Fail

1. **Capture full error output**
2. **Check test database state:**
   ```sql
   -- Verify test data still exists
   SELECT * FROM opening_balance_imports;
   SELECT * FROM accounting_firms WHERE name = 'Test Accounting Firm';
   ```
3. **Check environment:**
   - Verify `.env.test` is loaded
   - Verify test database connection
   - Verify test data IDs are correct
4. **Review test logic** against actual implementation
5. **Fix issues** (if implementation bug) or **update tests** (if test bug)

### Common Issues

**"Cannot find module"**
- **Fix:** Ensure test file paths are correct
- **Fix:** Check `moduleNameMapper` in `jest.config.js`

**"Database connection error"**
- **Fix:** Verify `.env.test` has correct Supabase credentials
- **Fix:** Check test database is accessible

**"User not found"**
- **Fix:** Re-run `TEST_DATABASE_SEED.sql`
- **Fix:** Verify user emails match in seed script

**"Table does not exist"**
- **Fix:** Apply all migrations to test database
- **Fix:** Verify migration `150_opening_balance_imports_step9_1.sql` applied

---

## TEST EXECUTION SCRIPT

Create `scripts/run-opening-balance-tests.sh` (or `.bat` for Windows):

```bash
#!/bin/bash
# Run all opening balance import tests

echo "=========================================="
echo "Step 9.1 Batch F — Test Execution"
echo "=========================================="
echo ""

# Load test environment
export NODE_ENV=test
if [ -f .env.test ]; then
  export $(cat .env.test | grep -v '^#' | xargs)
fi

echo "Environment: $NODE_ENV"
echo "Test Database: $NEXT_PUBLIC_SUPABASE_URL"
echo ""

# Run all test suites
echo "Running all opening balance tests..."
npm test -- opening-balances --verbose

echo ""
echo "=========================================="
echo "Test execution complete"
echo "=========================================="
```

---

## EXPECTED RESULTS SUMMARY

| Test Suite | Test Cases | Expected Status |
|------------|------------|-----------------|
| Canonical Builder | 20+ | ✅ PASS |
| Draft Lifecycle | 14 | ✅ PASS |
| Posting & Idempotency | 10 | ✅ PASS |
| Duplicate Protection | 7 | ✅ PASS |
| Period Lock Enforcement | 7 | ✅ PASS |
| Authority Enforcement | 11 | ✅ PASS |
| Audit Trail Integrity | 7 | ✅ PASS |
| **TOTAL** | **76+** | **✅ ALL PASS** |

---

## DEFINITION OF DONE

### ✅ PASS if:
- All test suites execute without errors
- All tests pass (76+ tests)
- No test database corruption
- All invariants validated

### ❌ FAIL if:
- Any test suite fails to execute
- Any test fails
- Test database state corrupted
- Invariants not validated

---

## POST-EXECUTION

After test execution:

1. **Document results** in `STEP9_1_BATCH_F_TEST_RESULTS.md`
2. **Capture test output** (save to file)
3. **Verify test database** (run `TEST_DATABASE_VERIFY.sql`)
4. **Reset test data** if needed (run `TEST_DATABASE_RESET.sql`)

---

**Status:** Ready for test execution

**Next:** Run test suites and capture results
