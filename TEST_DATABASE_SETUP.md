# Test Database Setup Guide
## Step 9.1 Batch F — Test Database Configuration

**Purpose:** Create a safe, repeatable test database for executing Batch F test suites without touching prod/dev data.

---

## OPTION A — Supabase Test Project (RECOMMENDED)

### Step 1: Create Test Project

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click "New Project"
3. Configure:
   - **Name:** `finza-test` (or `finza-web-test`)
   - **Database Password:** Generate strong password (save it)
   - **Region:** Match your dev project region
   - **Pricing Plan:** Free tier is sufficient for testing

4. Wait for project to be created (~2 minutes)

5. Save credentials:
   - Go to Project Settings → API
   - Copy:
     - `Project URL` → `SUPABASE_URL`
     - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
     - `anon` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (if needed)

---

### Step 2: Apply Migrations

**Critical:** Apply ALL migrations in order. Test DB must mirror dev schema exactly.

#### Option 2A: Using Supabase CLI (Recommended)

```bash
# Install Supabase CLI if not installed
npm install -g supabase

# Link to your test project
supabase link --project-ref YOUR_PROJECT_REF

# Apply all migrations
supabase db push
```

#### Option 2B: Manual Migration Application

1. Go to Supabase Dashboard → SQL Editor
2. Run migrations in order:
   - All core migrations (001-099)
   - Accounting workspace migrations (100+)
   - Step 8.x migrations (140-148)
   - Step 9.0 migrations (149)
   - Step 9.1 migrations (150-151)

**Verify:** Check that `opening_balance_imports` table exists:
```sql
SELECT * FROM information_schema.tables 
WHERE table_name = 'opening_balance_imports';
```

---

### Step 3: Seed Test Data

Run the seed script: `TEST_DATABASE_SEED.sql`

This creates:
- ✅ Test accounting firm
- ✅ Firm users (Partner, Senior, Junior)
- ✅ Test client business
- ✅ Minimal Chart of Accounts
- ✅ Accounting periods (open, locked)
- ✅ Active engagement
- ✅ Test accounts for opening balances

**Execute:**
```bash
# Using Supabase CLI
supabase db execute --file TEST_DATABASE_SEED.sql

# Or via Dashboard SQL Editor
# Copy/paste TEST_DATABASE_SEED.sql content
```

---

### Step 4: Environment Variables

Create `.env.test` file in project root:

```env
# Supabase Test Project
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here

# Test Configuration
NODE_ENV=test
TEST_DATABASE_URL=postgresql://postgres:[PASSWORD]@db.YOUR_PROJECT_REF.supabase.co:5432/postgres

# Test User IDs (will be set after seeding)
TEST_PARTNER_USER_ID=
TEST_SENIOR_USER_ID=
TEST_JUNIOR_USER_ID=
TEST_BUSINESS_ID=
TEST_FIRM_ID=
```

**Note:** Update `TEST_*_USER_ID` values after running seed script (check seed script output).

---

### Step 5: Verify Setup

Run verification queries:

```sql
-- Check firm exists
SELECT id, name FROM accounting_firms WHERE name = 'Test Accounting Firm';

-- Check users exist
SELECT id, email, role FROM accounting_firm_users 
WHERE firm_id = (SELECT id FROM accounting_firms WHERE name = 'Test Accounting Firm');

-- Check business exists
SELECT id, name FROM businesses WHERE name = 'Test Client Business';

-- Check periods exist
SELECT id, period_start, status FROM accounting_periods 
WHERE business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business');

-- Check engagement exists
SELECT id, status, access_level FROM firm_client_engagements 
WHERE client_business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business');
```

---

## OPTION B — Local PostgreSQL (Alternative)

If you prefer local testing:

1. Install PostgreSQL locally
2. Create database: `finza_test`
3. Apply migrations using `psql`:
   ```bash
   psql -d finza_test -f supabase/migrations/001_*.sql
   psql -d finza_test -f supabase/migrations/002_*.sql
   # ... continue for all migrations
   ```
4. Run seed script: `psql -d finza_test -f TEST_DATABASE_SEED.sql`
5. Update `.env.test` with local connection string

---

## TEST DATA RESET

To reset test data between test runs:

```sql
-- WARNING: This deletes all test data
-- Only run in test database!

DELETE FROM opening_balance_imports;
DELETE FROM journal_entries WHERE source_type = 'opening_balance';
DELETE FROM firm_client_engagements WHERE accounting_firm_id = (SELECT id FROM accounting_firms WHERE name = 'Test Accounting Firm');
DELETE FROM accounting_periods WHERE business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business');
DELETE FROM accounts WHERE business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business');
DELETE FROM businesses WHERE name = 'Test Client Business';
DELETE FROM accounting_firm_users WHERE firm_id = (SELECT id FROM accounting_firms WHERE name = 'Test Accounting Firm');
DELETE FROM accounting_firms WHERE name = 'Test Accounting Firm';

-- Then re-run TEST_DATABASE_SEED.sql
```

---

## NEXT STEPS

After setup:
1. ✅ Verify all migrations applied
2. ✅ Verify test data seeded
3. ✅ Update `.env.test` with correct IDs
4. ✅ Run test suites:
   ```bash
   npm test -- opening-balances
   ```

---

## TROUBLESHOOTING

### Migration Errors
- **Issue:** Migration fails with "relation already exists"
- **Fix:** Check if migration was partially applied. Drop and re-apply.

### Seed Script Errors
- **Issue:** Foreign key violations
- **Fix:** Ensure all migrations applied first. Check order.

### Connection Errors
- **Issue:** Cannot connect to test database
- **Fix:** Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.test`

### Missing Tables
- **Issue:** `opening_balance_imports` table not found
- **Fix:** Ensure migration `150_opening_balance_imports_step9_1.sql` was applied

---

**Status:** Ready for test database setup
