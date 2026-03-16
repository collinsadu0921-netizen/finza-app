# Test Execution Quick Reference
## Step 9.1 Batch F — Action 2

**Quick commands to execute all test suites**

---

## PREREQUISITES

1. ✅ Test database configured (see `TEST_DATABASE_QUICK_START.md`)
2. ✅ `.env.test` file created and populated
3. ✅ Test data seeded (run `TEST_DATABASE_SEED.sql`)

---

## QUICK EXECUTION

### Run All Opening Balance Tests

```bash
# Using npm
npm test -- opening-balances

# Using pnpm (if installed)
pnpm test opening-balances

# Using test script
npm run test:opening-balances
```

### Run Individual Test Suites

```bash
# 1. Canonical Builder
npm test -- lib/accounting/__tests__/openingBalanceImports.test.ts

# 2. Draft Lifecycle
npm test -- app/api/accounting/opening-balances/__tests__/lifecycle.test.ts

# 3. Posting & Idempotency
npm test -- app/api/accounting/opening-balances/__tests__/posting-idempotency.test.ts

# 4. Duplicate Protection
npm test -- app/api/accounting/opening-balances/__tests__/duplicate-protection.test.ts

# 5. Period Lock Enforcement
npm test -- app/api/accounting/opening-balances/__tests__/period-lock-enforcement.test.ts

# 6. Authority Enforcement
npm test -- app/api/accounting/opening-balances/__tests__/authority-enforcement.test.ts

# 7. Audit Trail Integrity
npm test -- app/api/accounting/opening-balances/__tests__/audit-trail.test.ts
```

---

## USING EXECUTION SCRIPTS

### Linux/Mac
```bash
chmod +x scripts/run-opening-balance-tests.sh
./scripts/run-opening-balance-tests.sh
```

### Windows
```cmd
scripts\run-opening-balance-tests.bat
```

---

## ENVIRONMENT SETUP

Before running tests, ensure:

```bash
# Set test environment
export NODE_ENV=test  # Linux/Mac
set NODE_ENV=test     # Windows

# Load .env.test (if using dotenv)
# The test scripts handle this automatically
```

---

## EXPECTED OUTPUT

When all tests pass, you should see:

```
PASS  lib/accounting/__tests__/openingBalanceImports.test.ts
PASS  app/api/accounting/opening-balances/__tests__/lifecycle.test.ts
PASS  app/api/accounting/opening-balances/__tests__/posting-idempotency.test.ts
PASS  app/api/accounting/opening-balances/__tests__/duplicate-protection.test.ts
PASS  app/api/accounting/opening-balances/__tests__/period-lock-enforcement.test.ts
PASS  app/api/accounting/opening-balances/__tests__/authority-enforcement.test.ts
PASS  app/api/accounting/opening-balances/__tests__/audit-trail.test.ts

Test Suites: 7 passed, 7 total
Tests:       76+ passed, 76+ total
```

---

## CAPTURE RESULTS

Save test output to file:

```bash
# Save all output
npm test -- opening-balances > test-results.txt 2>&1

# Save with timestamp
npm test -- opening-balances > test-results-$(date +%Y%m%d-%H%M%S).txt 2>&1
```

---

## TROUBLESHOOTING

### "Cannot find module"
- Run: `npm install` to ensure dependencies installed

### "Test database connection error"
- Verify `.env.test` has correct Supabase credentials
- Check test database is accessible

### "Tests are pending/skipped"
- This is expected - tests are marked as PENDING until implemented
- Review test files to see which tests need implementation

---

**Status:** Ready for execution
