# How to Enter Accountant-First Workspace

## Quick Answer

**To enter the Accountant-First workspace:**

1. **Log in** at `/login` with your email and password
2. **Navigate to Accounting Clients:** Go to `/firm/accounting-clients`
3. **Select or create a client:**
   - **Existing client:** Click "Enter Accounting" button
   - **New client:** Click "Add External Client (Books-Only)" → Fill form → Submit
4. **You're now in Accounting Workspace** at `/accounting?business_id=CLIENT_ID`

---

## Step-by-Step Entry Path

### Method 1: Via Firm Dashboard (Recommended)

1. **Log in** → `/login`
2. **Go to Firm Dashboard** → `/accounting/firm`
3. **Click "Accounting Clients"** button (top right)
4. **Click "Enter Accounting"** next to a client
5. **You're in!** → `/accounting?business_id=CLIENT_ID`

### Method 2: Direct to Accounting Clients

1. **Log in** → `/login`
2. **Go directly to Accounting Clients** → `/firm/accounting-clients`
3. **Click "Enter Accounting"** next to a client
4. **You're in!** → `/accounting?business_id=CLIENT_ID`

### Method 3: Create New Client & Enter

1. **Log in** → `/login`
2. **Go to Accounting Clients** → `/firm/accounting-clients`
3. **Click "Add External Client (Books-Only)"**
4. **Fill the form:**
   - Client Legal Name
   - Currency (default: GHS)
   - First Accounting Period Start Date
5. **Click "Create Client & Enter Accounting"**
6. **You're automatically redirected** to Accounting Workspace for that client

---

## What You'll See

Once you're in the Accounting Workspace (`/accounting`):

### Main Dashboard
- **Review & Validation** section:
  - Exception Review
  - Adjustments Review
  - AFS Review

- **Accounting Management** section:
  - General Ledger
  - Accounting Periods
  - Chart of Accounts
  - Opening Balances
  - Opening Balance Imports
  - Carry-Forward

- **Financial Reports** section:
  - Trial Balance
  - General Ledger Report
  - Profit & Loss
  - Balance Sheet

### Top Navigation
- **Firm Selector** (if you belong to multiple firms)
- **Client Selector** (shows which client you're working on)
- **Firm Role Badge** (shows your role: Partner, Senior, etc.)

### Sidebar
- **Hidden for books-only clients** (industry = null)
- **Shows service/POS navigation** only for non-books-only clients

---

## Prerequisites Check

Before you can enter, ensure:

✅ **You're logged in** (have a user account)  
✅ **You belong to an accounting firm** (in `accounting_firm_users` table)  
✅ **Firm onboarding is complete** (if not, you'll be redirected to `/accounting/firm/onboarding`)  
✅ **You have an active client engagement** (or create one via "Add External Client")

---

## Creating Your Account (First Time)

### Step 1: Sign Up

1. **Go to `/signup`**
2. **Fill in:**
   - Full Name
   - Email
   - Password (at least 6 characters)
3. **Click "Create account"**
4. **You'll be redirected to `/business-setup`**

### Step 2: Business Setup (Required by Current Flow)

**⚠️ Note:** The current signup flow requires creating a business, even for accounting firm users. This is a limitation of the current system.

1. **On `/business-setup` page, fill in:**
   - **Business name:** Enter any name (e.g., "My Accounting Firm" or "Personal")
   - **Business type:** Choose **"General Service"** or **"Professional Services"** (doesn't matter - you won't use this business for operations)
   - **Business start date:** Optional
2. **Click "Continue"**
3. **You'll be redirected to `/onboarding`**

### Step 3: Skip Onboarding (For Accounting Firm Users)

**⚠️ Important:** The onboarding flow is designed for business owners, not accounting firm users.

**Options:**
- **Option A:** Skip through onboarding quickly (create a dummy customer/product/invoice if required)
- **Option B:** Navigate directly to `/accounting/firm` and skip onboarding
- **Option C:** After signup, have someone add you to a firm via database, then you can skip business setup entirely

### Step 4: Get Added to an Accounting Firm

After account creation, you need to be added to an accounting firm:

**Via Database (SQL):**
```sql
-- 1. Get your user ID from auth.users (or from the users table)
-- 2. Create or find an accounting firm
INSERT INTO accounting_firms (name, created_by)
VALUES ('Your Firm Name', 'YOUR_USER_ID')
RETURNING id;

-- 3. Add yourself to the firm
INSERT INTO accounting_firm_users (firm_id, user_id, role)
VALUES ('FIRM_ID', 'YOUR_USER_ID', 'partner')
ON CONFLICT (firm_id, user_id) DO NOTHING;
```

**Then:**
- Log in at `/login`
- Navigate to `/accounting/firm/onboarding` to complete firm onboarding (Partner role required)
- Or navigate to `/firm/accounting-clients` to start working with clients

---

## Complete Setup Flow (First Time)

**Full path from zero to Accounting Workspace:**

```
1. /signup → Create account (email, password, name)
2. /business-setup → Create business (choose "General Service" or "Professional Services")
3. /onboarding → Skip through (or create dummy data if required)
4. [Database] → Add yourself to accounting firm (SQL)
5. /login → Log in
6. /accounting/firm/onboarding → Complete firm onboarding (Partner role)
7. /firm/accounting-clients → Add External Client (Books-Only)
8. ✅ You're in Accounting Workspace!
```

---

## Quick Test (After Setup)

**Fastest path to Accounting Workspace (once account and firm are set up):**

```
1. /login → Enter email/password → Sign in
2. /firm/accounting-clients → Click "Add External Client (Books-Only)"
3. Fill form → Submit
4. Auto-redirected to /accounting?business_id=NEW_CLIENT_ID
```

**You're now in the Accounting Workspace!**

---

## Troubleshooting

### "No firm selected"
- **Fix:** You need to belong to a firm. Check `accounting_firm_users` table.
- **Setup:** Add yourself to a firm via SQL (see "Step 4: Get Added to an Accounting Firm" above)

### Redirected to `/accounting/firm/onboarding`
- **Fix:** Complete firm onboarding (Partner role required).
- **Note:** You must have `role = 'partner'` in `accounting_firm_users` to complete onboarding

### "No active clients found"
- **Fix:** Click "Add External Client (Books-Only)" to create your first client.

### Can't see "Accounting Clients" button
- **Fix:** Ensure you're on `/accounting/firm` page and firm is selected.

### Sidebar still shows service/POS items
- **Fix:** This is expected if the client has `industry` set. Books-only clients (industry = null) hide service/POS navigation.

### Stuck in Business Onboarding
- **Problem:** After signup, you're forced through business onboarding
- **Fix:** 
  - Option 1: Skip through quickly (create dummy data if required)
  - Option 2: Navigate directly to `/accounting/firm` (may work if you're already added to a firm)
  - Option 3: Have someone add you to a firm BEFORE you complete business setup

### "Choose business type" - Which one?
- **Answer:** For accounting firm users, choose **"General Service"** or **"Professional Services"**
- **Why:** Doesn't matter - you won't use this business for operations. You'll work with client businesses instead.

---

## Key URLs

- **Login:** `/login`
- **Firm Dashboard:** `/accounting/firm`
- **Accounting Clients:** `/firm/accounting-clients`
- **Add External Client:** `/firm/accounting-clients/add`
- **Accounting Workspace:** `/accounting?business_id=CLIENT_ID`
- **Firm Onboarding:** `/accounting/firm/onboarding`

---

## Visual Flow

```
Login (/login)
    ↓
Firm Dashboard (/accounting/firm)
    ↓
Accounting Clients (/firm/accounting-clients)
    ↓
[Enter Accounting] OR [Add External Client]
    ↓
Accounting Workspace (/accounting?business_id=CLIENT_ID)
    ↓
✅ You can now:
   - Create opening balance imports
   - Create manual journals
   - View ledger
   - Close periods
   - Generate reports
```

---

## Notes

- **No business ownership needed:** You don't need to own a business to access accounting workspace
- **Firm context required:** You must have a firm selected (auto-selected if only one)
- **Client context required:** You must have a client selected (via "Enter Accounting" button)
- **Books-only clients:** Created via Step 9.2 have `industry = null` and are optimized for accounting-only workflows
