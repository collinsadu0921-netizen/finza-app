# How to Log In as an Accounting Firm User

## Quick Answer

**Accounting firm users log in the same way as regular users:**
1. Go to `/login`
2. Enter email and password
3. After login, navigate to `/accounting` or `/accounting/firm`
4. Select your firm from the Firm Selector (if you belong to multiple firms)
5. Complete firm onboarding if not already done

---

## Prerequisites

Before you can log in as an accounting firm user, you need:

1. **A user account** (created via `/signup` or manually in Supabase Auth)
2. **An accounting firm** (created in `accounting_firms` table)
3. **Firm membership** (your user added to `accounting_firm_users` table with a role)

---

## Setup Steps (One-Time)

### Option A: Manual Database Setup (Dev/Testing)

If you need to set up an accounting firm manually:

1. **Create a user account** (if not exists):
   - Go to `/signup` and create an account
   - Or create via Supabase Auth dashboard

2. **Create an accounting firm** (SQL):
   ```sql
   INSERT INTO accounting_firms (name, created_by)
   VALUES ('Your Firm Name', 'YOUR_USER_ID_HERE')
   RETURNING id;
   ```

3. **Add user to firm** (SQL):
   ```sql
   INSERT INTO accounting_firm_users (firm_id, user_id, role)
   VALUES ('FIRM_ID_FROM_STEP_2', 'YOUR_USER_ID', 'partner')
   ON CONFLICT (firm_id, user_id) DO NOTHING;
   ```

4. **Complete firm onboarding** (via UI):
   - Log in
   - Navigate to `/accounting/firm/onboarding`
   - Fill in required fields (legal name, jurisdiction, reporting standard)
   - Submit

### Option B: Use Existing Firm (If Already Set Up)

If a firm already exists and you're added to it:
1. Log in with your email/password
2. Navigate to `/accounting` or `/accounting/firm`
3. Select your firm from the Firm Selector dropdown (top navigation)
4. If onboarding is incomplete, you'll be redirected to complete it

---

## Login Flow

### Step 1: Login
- Go to `/login`
- Enter your email and password
- Click "Sign in"

### Step 2: Navigate to Accounting Workspace
After login, you'll be redirected to `/dashboard` (default). To access accounting:

- **Option A:** Navigate to `/accounting` directly
- **Option B:** Navigate to `/accounting/firm` (Firm Dashboard)
- **Option C:** Navigate to `/firm/accounting-clients` (Accounting Clients List)

### Step 3: Select Firm (If Multiple)
If you belong to multiple firms:
- Look for the **Firm Selector** dropdown in the top navigation
- Select your firm
- The system will auto-select if you only belong to one firm

### Step 4: Complete Onboarding (If Required)
If firm onboarding is incomplete:
- You'll be automatically redirected to `/accounting/firm/onboarding`
- Fill in:
  - Legal Name (required)
  - Jurisdiction (required)
  - Reporting Standard (required)
  - Default Accounting Standard (optional)
- Click "Complete Onboarding"
- You'll be redirected to `/accounting/firm`

---

## Accessing Accountant-First Mode (Step 9.2)

Once logged in and firm is selected:

1. **Go to Firm Dashboard:**
   - Navigate to `/accounting/firm`
   - Click **"Accounting Clients"** button (top right)

2. **Or go directly to Accounting Clients:**
   - Navigate to `/firm/accounting-clients`

3. **Add External Client (Books-Only):**
   - Click **"Add External Client (Books-Only)"** button
   - Fill in:
     - Client Legal Name
     - Currency
     - First Accounting Period Start Date
   - Click **"Create Client & Enter Accounting"**
   - You'll be redirected to Accounting Workspace for that client

4. **Enter Accounting for Existing Client:**
   - On `/firm/accounting-clients` page
   - Click **"Enter Accounting"** button next to the client
   - You'll be redirected to `/accounting?business_id=CLIENT_ID`

---

## Troubleshooting

### "No firm selected"
- **Cause:** You don't belong to any accounting firm
- **Fix:** Add yourself to a firm in `accounting_firm_users` table

### "Firm onboarding must be completed"
- **Cause:** Firm onboarding is incomplete
- **Fix:** Navigate to `/accounting/firm/onboarding` and complete it (Partner role required)

### "Only Partners and Seniors can..."
- **Cause:** Your role in the firm is `junior` or `readonly`
- **Fix:** Update your role in `accounting_firm_users` table to `partner` or `senior`

### Firm Selector Not Showing
- **Cause:** You don't belong to any firms, or you're not in accounting workspace
- **Fix:** 
  - Ensure you're on a route starting with `/accounting`
  - Check that you're added to a firm in `accounting_firm_users`

### Sidebar Shows Service/POS Navigation
- **Cause:** You're viewing a client that has `industry` set (not books-only)
- **Fix:** This is expected for non-books-only clients. Books-only clients (industry = null) will hide service/POS navigation.

---

## Quick Test Flow

**Fastest way to test Accountant-First mode:**

1. **Create firm and user** (one-time, via SQL or UI):
   ```sql
   -- Get your user ID from auth.users
   -- Then create firm and add yourself
   ```

2. **Log in** → `/login`

3. **Go to Accounting Clients** → `/firm/accounting-clients`

4. **Add External Client** → Fill form → Submit

5. **Enter Accounting** → You're now in Accounting Workspace for that client

**Time to first journal:** < 60 seconds (after client creation)

---

## Notes

- **No business ownership required:** Accounting firm users don't need to own a business
- **Firm context is required:** You must select a firm before accessing accounting features
- **Client context is required:** You must select a client before working on their books
- **Books-only clients:** Created via `/firm/accounting-clients/add` have `industry = null` and hide service/POS UI

---

## Related Files

- Login page: `app/login/page.tsx`
- Firm Dashboard: `app/accounting/firm/page.tsx`
- Accounting Clients: `app/firm/accounting-clients/page.tsx`
- Firm Onboarding: `app/accounting/firm/onboarding/page.tsx`
- Firm Selector: `components/FirmSelector.tsx`
- Client Selector: `components/ClientSelector.tsx`
