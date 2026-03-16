# Dev Guide: Accessing Accountant-First / External Accounting Mode

**Purpose:** Practical steps to test external accounting (firm managing client books) without service/POS/invoicing flows.

---

## QUICK ANSWER

### 1. User Role / Account Type
**Log in as:** Regular user account (no special "accountant" account type needed)

### 2. Setup Steps (Required)
1. **Create a firm** (via SQL - no UI exists yet)
2. **Add yourself as firm user** (via SQL)
3. **Create a client business** (books-only shell via UI)
4. **Create an engagement** (via UI at `/accounting/firm/clients/add`)

### 3. Switch Context
- **Firm context:** Use `FirmSelector` component (auto-appears in `/accounting/*` routes)
- **Client context:** Use `ClientSelector` component (auto-appears after firm selected)

### 4. Access Routes
- `/accounting` - Landing page
- `/accounting/periods` - Period management (with Close Center)
- `/accounting/drafts` - Manual journal drafts
- `/accounting/journals` - Journal entries

### 5. Fastest Sanity Test
1. Create manual journal draft
2. Submit → Approve → Post
3. Go to `/accounting/periods`
4. Click "Close Center" on a period
5. Request close → Approve → Lock

---

## DETAILED SETUP (Step-by-Step)

### Step 1: Create Accounting Firm (SQL)

**No UI exists for firm creation. Use SQL:**

```sql
-- 1. Get your user ID from auth.users
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';

-- 2. Create firm (replace YOUR_USER_ID with actual ID)
INSERT INTO accounting_firms (name, created_by)
VALUES ('Test Accounting Firm', 'YOUR_USER_ID')
RETURNING id, name;

-- 3. Add yourself as Partner (replace FIRM_ID and YOUR_USER_ID)
INSERT INTO accounting_firm_users (firm_id, user_id, role)
VALUES ('FIRM_ID', 'YOUR_USER_ID', 'partner')
RETURNING *;
```

**Save the `firm_id` - you'll need it.**

---

### Step 2: Create Client Business (UI)

1. **Log in** with your account
2. **Create business:**
   - Go to `/business-setup`
   - Name: "Test Client Business"
   - Industry: **"service"** (required - system accounts auto-created)
   - Start date: Any date
3. **Complete onboarding:**
   - You'll be redirected to `/onboarding`
   - **Skip steps or create minimal data:**
     - Business Profile: Fill required fields
     - Add Customer: Create one dummy customer
     - Add Product: Create one dummy product
     - Create Invoice: Create one dummy invoice (required to complete onboarding)
4. **Save the `business_id`** from URL or database

**Note:** The dummy invoice is required to complete onboarding, but won't affect accounting tests.

---

### Step 3: Complete Firm Onboarding (UI)

1. **Navigate to:** `/accounting/firm/onboarding`
2. **Fill required fields:**
   - Legal Name: "Test Accounting Firm Ltd"
   - Jurisdiction: "Ghana" (or any)
   - Reporting Standard: "IFRS" (or any)
   - Default Accounting Standard: (optional)
3. **Click "Complete Onboarding"**

**If you get "No firm selected" error:**
- The firm needs to be set in sessionStorage
- Go to `/accounting/firm` first (it will auto-select if you're in one firm)
- Or manually set: `sessionStorage.setItem('finza_active_firm_id', 'YOUR_FIRM_ID')`

---

### Step 4: Create Engagement (UI)

1. **Navigate to:** `/accounting/firm/clients/add`
2. **Search for business:** Type the client business name
3. **Select business** from dropdown
4. **Set access level:** "approve" (for full testing)
5. **Set effective from:** Today's date
6. **Effective to:** Leave empty (ongoing)
7. **Click "Create Engagement"**

**Engagement starts as "pending"** - needs client acceptance. For dev testing, you can manually accept it in SQL:

```sql
-- Accept engagement (replace ENGAGEMENT_ID and YOUR_USER_ID)
UPDATE firm_client_engagements
SET status = 'active',
    accepted_by = 'YOUR_USER_ID',
    accepted_at = NOW()
WHERE id = 'ENGAGEMENT_ID';
```

---

### Step 5: Switch to Client Context

1. **Navigate to:** `/accounting` (or any `/accounting/*` route)
2. **Firm Selector** appears in header (if you belong to multiple firms)
3. **Client Selector** appears below firm selector
4. **Select your client business** from dropdown
5. **You're now in client context**

**Context is stored in sessionStorage:**
- `finza_active_firm_id` - Active firm
- `finza_active_client_business_id` - Active client

---

## TESTING WORKFLOWS

### Test 1: Manual Journal Draft → Post → Close Period

1. **Go to:** `/accounting/drafts`
2. **Create draft:**
   - Click "New Draft"
   - Select period (must be open)
   - Entry date: Within period
   - Description: "Test manual journal"
   - Add lines: At least 2 lines, debits = credits
3. **Submit draft:**
   - Status: `draft → submitted`
4. **Approve draft:**
   - Requires Partner/Senior role with `approve` engagement access
   - Status: `submitted → approved`
5. **Post to ledger:**
   - Requires Partner role
   - Status: `approved → posted` (journal_entry_id set)
6. **Close period:**
   - Go to `/accounting/periods`
   - Click "Close Center" on the period
   - Click "Request Close"
   - As Partner, click "Approve Close" (moves to `soft_closed`)
   - Click "Lock Period" (moves to `locked`)

---

### Test 2: Period Close Readiness Checks

1. **Go to:** `/accounting/periods`
2. **Click "Close Center"** on any period
3. **Readiness panel shows:**
   - **Blockers:** Period locked, unposted approved drafts, duplicate requests
   - **Warnings:** Drafts exist, submitted journals exist
4. **Test blockers:**
   - Create approved but unposted draft → Request close should be blocked
   - Post the draft → Request close should be allowed

---

### Test 3: Posting Block on Locked Period

1. **Lock a period** (via Close Center)
2. **Try to post:**
   - Manual journal draft → Should fail with "period is locked" error
   - Adjusting journal → Should fail
   - Invoice posting → Should fail
3. **Verify:** No ledger entries created

---

## ROUTE GUARDS & FLAGS

### Route Guards That Block Access

1. **Firm onboarding incomplete:**
   - **Blocks:** All accounting actions
   - **Error:** "Firm onboarding must be completed"
   - **Fix:** Complete `/accounting/firm/onboarding`

2. **No active engagement:**
   - **Blocks:** Client data access
   - **Error:** "No active engagement found"
   - **Fix:** Create engagement and accept it

3. **Engagement not effective:**
   - **Blocks:** Actions if `effective_from > today`
   - **Error:** "Engagement is not yet effective"
   - **Fix:** Set `effective_from <= today` in SQL

4. **Insufficient authority:**
   - **Blocks:** Actions based on firm role + engagement access
   - **Error:** "Insufficient authority"
   - **Fix:** Ensure role is `partner` and access is `approve`

---

## DEV SHORTCUTS (SQL)

### Quick Firm + User Setup

```sql
-- Replace YOUR_USER_ID with actual user ID
WITH new_firm AS (
  INSERT INTO accounting_firms (name, created_by)
  VALUES ('Dev Test Firm', 'YOUR_USER_ID')
  RETURNING id
)
INSERT INTO accounting_firm_users (firm_id, user_id, role)
SELECT id, 'YOUR_USER_ID', 'partner'
FROM new_firm
RETURNING *;
```

### Quick Engagement Setup

```sql
-- Replace FIRM_ID, BUSINESS_ID, YOUR_USER_ID
INSERT INTO firm_client_engagements (
  accounting_firm_id,
  client_business_id,
  status,
  access_level,
  effective_from,
  created_by,
  accepted_by,
  accepted_at
)
VALUES (
  'FIRM_ID',
  'BUSINESS_ID',
  'active',  -- Skip pending, go straight to active
  'approve', -- Full access
  CURRENT_DATE,
  'YOUR_USER_ID',
  'YOUR_USER_ID',  -- Self-accept
  NOW()
)
RETURNING *;
```

### Set Firm in Session (Browser Console)

```javascript
// In browser console on /accounting page
sessionStorage.setItem('finza_active_firm_id', 'YOUR_FIRM_ID');
sessionStorage.setItem('finza_active_firm_name', 'Test Firm');
window.location.reload();
```

### Set Client in Session (Browser Console)

```javascript
// After firm is set
sessionStorage.setItem('finza_active_client_business_id', 'YOUR_BUSINESS_ID');
sessionStorage.setItem('finza_active_client_business_name', 'Test Client');
window.location.reload();
```

---

## VERIFICATION CHECKLIST

### ✅ You're in the right mode if:

1. **Firm Selector visible** in `/accounting/*` routes
2. **Client Selector visible** after firm selected
3. **Can access:** `/accounting/drafts`, `/accounting/periods`, `/accounting/journals`
4. **Can create:** Manual journal drafts
5. **Can approve:** Drafts (if Partner role)
6. **Can post:** Approved drafts to ledger
7. **Can close periods:** Request → Approve → Lock workflow works
8. **Locked periods block posting:** Verified with error messages

### ❌ You're NOT in the right mode if:

1. **No firm selector** → Firm not created or user not added to firm
2. **"Firm onboarding required"** → Complete `/accounting/firm/onboarding`
3. **"No active engagement"** → Create and accept engagement
4. **"Insufficient authority"** → Check role is `partner` and access is `approve`
5. **Can't see client data** → Engagement not active or not effective

---

## TROUBLESHOOTING

### Problem: "No firm selected"
**Solution:**
- Check `accounting_firm_users` table - is your user_id linked to a firm?
- Manually set in sessionStorage (see shortcuts above)
- Navigate to `/accounting/firm` - it should auto-select if you're in one firm

### Problem: "Firm onboarding must be completed"
**Solution:**
- Go to `/accounting/firm/onboarding`
- Fill required fields and complete
- Or manually set in SQL:
  ```sql
  UPDATE accounting_firms
  SET onboarding_status = 'completed',
      onboarding_completed_at = NOW(),
      onboarding_completed_by = 'YOUR_USER_ID',
      legal_name = 'Test Firm',
      jurisdiction = 'Ghana',
      reporting_standard = 'IFRS'
  WHERE id = 'YOUR_FIRM_ID';
  ```

### Problem: "No active engagement found"
**Solution:**
- Create engagement at `/accounting/firm/clients/add`
- Or manually accept in SQL (see shortcuts above)
- Ensure `status = 'active'` and `effective_from <= CURRENT_DATE`

### Problem: "Insufficient authority"
**Solution:**
- Check your role in `accounting_firm_users` - must be `partner` for approve actions
- Check engagement `access_level` - must be `approve` for approve actions
- Check engagement `status` - must be `active`

### Problem: Can't see accounting routes
**Solution:**
- Ensure you're logged in
- Check `business_users` table - you should have a role (admin/owner)
- Accounting routes are accessible to any authenticated user with a business

---

## FASTEST PATH (5 Minutes)

1. **SQL: Create firm + add yourself as partner** (2 min)
2. **SQL: Create client business** (1 min) - or use UI
3. **SQL: Create and accept engagement** (1 min)
4. **Browser: Set firm in sessionStorage** (30 sec)
5. **Browser: Navigate to `/accounting/periods`** (30 sec)
6. **Test: Click "Close Center"** → Should work!

---

## NOTES

- **No UI for firm creation** - must use SQL
- **Onboarding requires invoice** - create one dummy invoice to complete
- **Engagement acceptance** - can be done in SQL for dev testing
- **Context switching** - Firm and Client selectors handle this automatically
- **All accounting routes** work once firm + engagement + context are set

---

**Last Updated:** 2025-01-27  
**Status:** Current as of Step 9.0 implementation
