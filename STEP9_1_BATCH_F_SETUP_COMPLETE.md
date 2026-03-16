# Step 9.1 — Batch F — Test Database Setup
## Configuration Complete ✅

**Status:** All setup files created and ready for use

---

## FILES CREATED

### 1. Setup Documentation
- ✅ `TEST_DATABASE_SETUP.md` - Comprehensive setup guide
- ✅ `TEST_DATABASE_QUICK_START.md` - Fast 10-minute setup guide

### 2. Database Scripts
- ✅ `TEST_DATABASE_SEED.sql` - Seed minimal test data
- ✅ `TEST_DATABASE_VERIFY.sql` - Verify setup completeness
- ✅ `TEST_DATABASE_RESET.sql` - Reset test data between runs

### 3. Configuration Templates
- ✅ `TEST_ENV_TEMPLATE.txt` - Environment variables template

---

## SETUP CHECKLIST

### Prerequisites
- [ ] Supabase account
- [ ] Access to Supabase Dashboard

### Step 1: Create Test Project
- [ ] Create Supabase project: `finza-test`
- [ ] Save database password
- [ ] Get credentials (URL, service_role key, anon key)

### Step 2: Create Test Users
- [ ] Create `test-partner@example.com` in Supabase Auth
- [ ] Create `test-senior@example.com` in Supabase Auth
- [ ] Create `test-junior@example.com` in Supabase Auth

### Step 3: Apply Migrations
- [ ] Apply all migrations in order (001 → 151)
- [ ] Verify `opening_balance_imports` table exists

### Step 4: Seed Test Data
- [ ] Run `TEST_DATABASE_SEED.sql` in SQL Editor
- [ ] Update user emails in script if different
- [ ] Verify no errors

### Step 5: Verify Setup
- [ ] Run `TEST_DATABASE_VERIFY.sql`
- [ ] All checks should show ✅

### Step 6: Configure Environment
- [ ] Create `.env.test` file
- [ ] Copy from `TEST_ENV_TEMPLATE.txt`
- [ ] Fill in Supabase credentials
- [ ] Get test data IDs and add to `.env.test`

---

## TEST DATA STRUCTURE

### Firm
- **Name:** Test Accounting Firm
- **ID:** `00000000-0000-0000-0000-000000000001`
- **Onboarding:** Completed

### Users (3)
- Partner: `test-partner@example.com`
- Senior: `test-senior@example.com`
- Junior: `test-junior@example.com`

### Business
- **Name:** Test Client Business
- **ID:** `00000000-0000-0000-0000-000000000002`
- **Industry:** service

### Accounts (4)
- Cash (1000) - Asset
- Accounts Receivable (1200) - Asset
- Accounts Payable (2000) - Liability
- Owner Equity (3000) - Equity

### Periods (2)
- Open period: Current month (for opening balances)
- Locked period: Previous month (for lock tests)

### Engagement
- **Status:** active
- **Access Level:** approve
- **Effective:** From 1 month ago, no end date

---

## NEXT STEPS

1. ✅ Complete setup checklist above
2. ✅ Run test suites:
   ```bash
   npm test -- opening-balances
   ```
3. ✅ Perform manual UI acceptance checks
4. ✅ Mark Batch F as ACCEPTED when all tests pass

---

## QUICK REFERENCE

### Reset Test Data
```sql
-- Run TEST_DATABASE_RESET.sql
-- Then re-run TEST_DATABASE_SEED.sql
```

### Verify Setup
```sql
-- Run TEST_DATABASE_VERIFY.sql
-- All checks should show ✅
```

### Get Test IDs
```sql
-- Run in SQL Editor to get IDs for .env.test
SELECT 'TEST_FIRM_ID=' || id FROM accounting_firms WHERE name = 'Test Accounting Firm';
SELECT 'TEST_BUSINESS_ID=' || id FROM businesses WHERE name = 'Test Client Business';
SELECT 'TEST_PARTNER_USER_ID=' || id FROM auth.users WHERE email = 'test-partner@example.com';
```

---

**Status:** ✅ **SETUP FILES COMPLETE**

Ready for test database configuration and test execution.
