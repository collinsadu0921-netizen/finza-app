# Test Database Quick Start Guide
## Step 9.1 Batch F — Fast Setup

**Goal:** Get test database running in ~10 minutes

---

## PREREQUISITES

- Supabase account
- Access to Supabase Dashboard

---

## STEP-BY-STEP SETUP

### 1. Create Supabase Test Project (2 min)

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click **"New Project"**
3. Fill in:
   - **Name:** `finza-test`
   - **Database Password:** Generate and **SAVE IT**
   - **Region:** Same as dev
4. Wait for project creation (~2 minutes)

---

### 2. Get Credentials (1 min)

1. Go to **Project Settings → API**
2. Copy:
   - `Project URL` → Save as `SUPABASE_URL`
   - `service_role` key → Save as `SUPABASE_SERVICE_ROLE_KEY`
   - `anon` key → Save as `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

### 3. Create Test Users (2 min)

Go to **Authentication → Users → Add User**

Create **3 users**:

| Email | Password | Role |
|-------|----------|------|
| `test-partner@example.com` | `TestPassword123!` | Partner |
| `test-senior@example.com` | `TestPassword123!` | Senior |
| `test-junior@example.com` | `TestPassword123!` | Junior |

**Note:** You can use any email domain, just update the seed script.

---

### 4. Apply Migrations (3 min)

**Option A: Supabase CLI (Recommended)**

```bash
# Install Supabase CLI
npm install -g supabase

# Link to test project
supabase link --project-ref YOUR_PROJECT_REF

# Apply all migrations
supabase db push
```

**Option B: Manual (SQL Editor)**

1. Go to **SQL Editor** in Supabase Dashboard
2. Run migrations in order:
   - All migrations from `supabase/migrations/` folder
   - Start with lowest number, end with `151_opening_balance_posting_step9_1_batch_c.sql`

**Verify:**
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_name = 'opening_balance_imports';
-- Should return 1 row
```

---

### 5. Seed Test Data (1 min)

1. Go to **SQL Editor**
2. Open `TEST_DATABASE_SEED.sql`
3. **Update user emails** if you used different emails in Step 3
4. Run the script
5. Check for errors (should be none)

---

### 6. Verify Setup (1 min)

Run `TEST_DATABASE_VERIFY.sql` in SQL Editor.

**Expected:** All checks show ✅

---

### 7. Configure Environment (1 min)

1. Create `.env.test` file in project root
2. Copy from `TEST_ENV_TEMPLATE.txt`
3. Fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `TEST_DATABASE_URL` (with password from Step 1)

4. Get test data IDs:
   ```sql
   -- Run in SQL Editor
   SELECT 'TEST_FIRM_ID=' || id FROM accounting_firms WHERE name = 'Test Accounting Firm';
   SELECT 'TEST_BUSINESS_ID=' || id FROM businesses WHERE name = 'Test Client Business';
   SELECT 'TEST_PARTNER_USER_ID=' || id FROM auth.users WHERE email = 'test-partner@example.com';
   SELECT 'TEST_SENIOR_USER_ID=' || id FROM auth.users WHERE email = 'test-senior@example.com';
   SELECT 'TEST_JUNIOR_USER_ID=' || id FROM auth.users WHERE email = 'test-junior@example.com';
   ```

5. Add IDs to `.env.test`

---

## VERIFY COMPLETE SETUP

Run this query in SQL Editor:

```sql
-- Should return all ✅
SELECT 
  'Firm' as check_type,
  CASE WHEN COUNT(*) = 1 THEN '✅' ELSE '❌' END as status
FROM accounting_firms WHERE name = 'Test Accounting Firm'
UNION ALL
SELECT 
  'Business' as check_type,
  CASE WHEN COUNT(*) = 1 THEN '✅' ELSE '❌' END as status
FROM businesses WHERE name = 'Test Client Business'
UNION ALL
SELECT 
  'Firm Users' as check_type,
  CASE WHEN COUNT(*) = 3 THEN '✅' ELSE '❌' END as status
FROM accounting_firm_users 
WHERE firm_id = (SELECT id FROM accounting_firms WHERE name = 'Test Accounting Firm')
UNION ALL
SELECT 
  'Periods' as check_type,
  CASE WHEN COUNT(*) >= 2 THEN '✅' ELSE '❌' END as status
FROM accounting_periods 
WHERE business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business')
UNION ALL
SELECT 
  'Engagement' as check_type,
  CASE WHEN COUNT(*) = 1 THEN '✅' ELSE '❌' END as status
FROM firm_client_engagements 
WHERE accounting_firm_id = (SELECT id FROM accounting_firms WHERE name = 'Test Accounting Firm');
```

---

## RUN TESTS

```bash
# Run all opening balance tests
npm test -- opening-balances

# Run specific test suite
npm test -- opening-balances/lifecycle.test.ts
```

---

## RESET TEST DATA

Between test runs, reset data:

1. Run `TEST_DATABASE_RESET.sql` in SQL Editor
2. Re-run `TEST_DATABASE_SEED.sql`

---

## TROUBLESHOOTING

### "User not found" error
- **Fix:** Create users in Supabase Auth first (Step 3)

### "Table does not exist" error
- **Fix:** Apply all migrations (Step 4)

### "Foreign key violation" error
- **Fix:** Run seed script in order, check dependencies

### Connection errors
- **Fix:** Verify `.env.test` has correct credentials

---

**Total Setup Time:** ~10 minutes

**Status:** Ready for test execution
