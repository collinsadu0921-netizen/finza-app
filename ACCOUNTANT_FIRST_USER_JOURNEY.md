# Accountant-First Workspace: User Journey Guide

**Version:** 1.0  
**Audience:** Product Managers, Accountants, Business Stakeholders  
**Focus:** User Experience & Problem-Solving

---

## Table of Contents

1. [The Firm Dashboard (Command Center)](#1-the-firm-dashboard-command-center)
2. [The "Enter Accounting" Experience](#2-the-enter-accounting-experience)
3. [The Adjustment Workflow](#3-the-adjustment-workflow)
4. [Import & Reconciliation UI](#4-import--reconciliation-ui)
5. [Reporting & Closing](#5-reporting--closing)

---

## 1. The Firm Dashboard (Command Center)

### Problem It Solves
Accountants managing multiple clients need a single view to understand their entire portfolio at a glance - which clients need attention, which are on track, and what actions require immediate action.

### At-a-Glance Metrics

When an accountant logs in, the **Firm Dashboard** displays three key metric cards at the top:

1. **Total Clients**
   - **Display:** Large number showing total number of clients managed by the firm
   - **Purpose:** Quick reference for portfolio size

2. **Clients with Draft AFS**
   - **Display:** Number highlighted in blue
   - **Purpose:** Shows how many clients have draft Annual Financial Statements awaiting finalization
   - **Action Trigger:** Accountant can quickly see which clients need AFS attention

3. **Clients Blocked by Preflight**
   - **Display:** Number highlighted in red
   - **Purpose:** Shows clients that have validation errors preventing critical actions (like AFS finalization)
   - **Action Trigger:** Immediate attention required - these clients cannot proceed until blockers are resolved

### Client List Organization

The main table displays all clients in a structured format with the following columns:

#### Client Information
- **Business Name:** The client's business name (clickable to enter their workspace)
- **Access Level:** Badge showing firm's access level:
  - **Read** (gray badge) - View-only access
  - **Write** (blue badge) - Can create entries
  - **Approve** (purple badge) - Can approve and post entries

#### Status Indicators

Each client row shows critical status information:

1. **Period Status Badge:**
   - **Open** (green) - Period is active, entries can be posted
   - **Soft Closed** (yellow) - Period is closed but can be reopened
   - **Locked** (gray) - Period is permanently locked, no changes allowed
   - **No Period** (gray) - No accounting period exists yet

2. **Period:** Shows the current accounting period in "MMM YYYY" format (e.g., "Jan 2024")

3. **Pending Adjustments:**
   - **Display:** Orange number if > 0, gray if 0
   - **Purpose:** Shows count of unapproved adjusting journal entries
   - **Action Trigger:** High number indicates review needed

4. **AFS Status Badge:**
   - **None** (gray) - No AFS started
   - **Draft** (blue) - AFS in progress
   - **Finalized** (green) - AFS completed

5. **Exceptions Count:**
   - **Critical** (red) - Shows count of critical exceptions
   - **Warning** (yellow) - Shows count of warning-level exceptions
   - **Dash (—)** if no exceptions

### Identifying "Out of Balance" Clients

The system identifies problematic clients through several visual cues:

1. **Critical Exceptions:** Red badge showing critical exception count in the Exceptions column
2. **Pending Adjustments:** Orange-highlighted numbers for clients with pending adjustments
3. **Preflight Blockers:** Clients shown in "Clients Blocked by Preflight" metric
4. **Period Status:** Locked periods indicate past issues, while "No Period" might indicate setup needed

### Filtering & Organization

Accountants can filter the client list using:

1. **Period Filter:** Month selector to view clients by specific accounting period
2. **Risk Filter:** Dropdown to filter for "Critical Exceptions" only
3. **Jurisdiction Filter:** (Coming soon) Filter by geographic jurisdiction

### Quick Actions

Below the metrics, a **Quick Actions** section provides buttons for common firm-wide operations:

1. **Add Client** (green button) - Opens client addition workflow
2. **Bulk Preflight** (blue button) - Runs validation across all clients to identify blockers
3. **Bulk AFS Finalize** (purple button) - Finalizes AFS for all clients with draft status

These buttons are context-aware - they're disabled if the user doesn't have the required permissions (e.g., only Partners can add clients).

### Activity Tab

A second tab shows **Activity Log** - a chronological timeline of all firm actions:
- Engagement creations
- AFS finalizations
- Bulk operations
- Access changes

Each activity entry shows:
- Action type (formatted, human-readable)
- Timestamp
- Actor (user who performed the action)
- Metadata (structured details about the action)

This helps accountants audit firm-wide activities and understand what happened when.

---

## 2. The "Enter Accounting" Experience

### Problem It Solves
When working with multiple clients, accountants need a clear, focused workspace that shows only accounting-related features - not operational features like invoicing or POS that are irrelevant for "books-only" clients.

### First Screen After Clicking "Enter Accounting"

When an accountant clicks the blue **"Enter Accounting"** button next to a client in the Firm Dashboard, they're taken to the **Accounting Workspace Landing Page** (`/accounting`).

This landing page is organized into three main sections:

#### 1. Review & Validation (Top Section)
Three large cards for critical review tasks:

- **Exception Review** (⚠️ red card) - Review and resolve accounting exceptions detected by the "Silent Auditor"
- **Adjustments Review** (📝 orange card) - Review and validate adjusting journal entries awaiting approval
- **AFS Review** (📊 blue card) - Review and finalize Accounting Financial Statements

#### 2. Accounting Management (Middle Section)
Six cards for core accounting operations:

- **General Ledger** (📖 blue) - View all journal entries and transactions
- **Accounting Periods** (📅 purple) - View and manage accounting periods
- **Chart of Accounts** (📋 indigo) - Read-only view of all accounts
- **Opening Balances** (💰 amber) - Set opening balances for asset, liability, and equity accounts
- **Opening Balance Imports** (📥 emerald) - Create and manage opening balance imports for external clients
- **Carry-Forward** (➡️ teal) - Generate next-period opening balances from prior period ending balances

#### 3. Financial Reports (Bottom Section)
Four read-only report cards:

- **Trial Balance** (⚖️ green) - Verify ledger is balanced
- **General Ledger Report** (📊 blue) - Detailed entries for a selected account
- **Profit & Loss** (📈 emerald) - Income and expenses for a period
- **Balance Sheet** (📋 indigo) - Assets, liabilities, and equity as of a date

Each card is clickable and navigates to the specific feature.

### Sidebar Menu Items (Accounting Workspace)

When working in the accounting workspace, the sidebar dynamically adapts based on the client's business type:

#### For "Books-Only" Clients (Industry = null)

The sidebar **hides operational sections** and shows only:

**ACCOUNTING (Advanced) Section:**
- Chart of Accounts
- General Ledger
- Trial Balance
- Reconciliation
- Audit Log

**SETTINGS Section:**
- Business Profile
- Business Settings

**Problem It Solves:** For clients that don't use FINZA for daily operations, the accountant doesn't need to see irrelevant features like "Invoices" or "POS Terminal." This keeps the interface clean and focused on accounting tasks.

#### Differences from Business Owner Sidebar

**Business Owner Sidebar** shows:
- Service Operations (Invoices, Payments, Orders, Clients, Products, Expenses)
- Finance & Reporting (P&L, Balance Sheet, VAT Returns, Financial Reports)
- Accounting (Advanced) - Same as accountant view
- Settings (Business Profile, Invoice Settings, Payment Settings, Staff Management)

**Accountant Sidebar** (for books-only clients) shows:
- **Only** Accounting (Advanced) section
- **Only** basic Settings (Business Profile, Business Settings)
- **No** operational sections (Invoices, Payments, POS, etc.)

This ensures accountants working with external clients see a focused, accounting-only interface.

---

## 3. The Adjustment Workflow

### Problem It Solves
Accountants need to correct accounting errors or make adjusting entries, but these changes must be:
1. **Auditable** - Permanent record of who made what change and when
2. **Approved** - Senior accountants or partners must review before posting
3. **Period-Aware** - Cannot adjust locked periods

### UI for Creating Manual Journal Entries

The adjustment workflow is accessed via **Accounting Workspace → Adjustments Review** card, or directly at `/accounting/adjustments`.

#### Form Layout

The page displays a clean form with the following sections:

**1. Period Selection**
- Dropdown showing all **open** accounting periods
- Only open periods can be adjusted (locked/soft_closed periods are excluded)
- **Problem It Solves:** Prevents accidental adjustments to historical locked periods

**2. Entry Date**
- Date picker defaulting to the selected period's start date
- Date must fall within the selected period's date range
- **Validation:** Date must be >= period_start and <= period_end

**3. Description Field**
- Required text input for the journal entry description
- Example placeholder text: "Monthly depreciation adjustment"
- **Problem It Solves:** Clear documentation of why the adjustment was made

**4. Journal Lines Table**

A dynamic table for entering debit/credit lines:

- **Add Line Button** - Creates a new row (minimum 2 lines enforced)
- **Remove Button** - Removes a line (disabled if only 2 lines remain)
- **Account Selector** - Dropdown showing ALL accounts:
  - Format: `[Account Code] - [Account Name] ([Type]) [System]`
  - Example: "1000 - Cash (asset) [System]"
  - Includes both system and custom accounts

- **Debit/Credit Inputs:**
  - Two number inputs per line (debit and credit)
  - **Smart Behavior:** Typing in one field automatically clears the other
  - Each line must have either debit > 0 OR credit > 0, but not both
  - Numbers formatted to 2 decimal places

- **Line Description** (optional) - Additional memo for each line

- **Running Totals Display:**
  - Shows total debits and total credits at the bottom
  - **Balance Indicator:**
    - ✓ **Balanced** (green) when debits = credits
    - **Imbalance: X.XX** (red) when debits ≠ credits

**5. Apply Button**
- Disabled until all validation passes:
  - Period selected
  - Entry date within period
  - Description not empty
  - At least 2 lines
  - All lines have account_id
  - All lines have debit > 0 OR credit > 0
  - **Entry is balanced** (debits = credits)

### "Propose Adjustment" Feature

**Note:** The current implementation creates adjustments directly, but the workflow supports a **draft-approval-posting** model for firm users:

#### Current Workflow (Direct Creation)

1. Accountant fills out the form
2. Clicks "Apply" button
3. Confirmation modal appears

#### Confirmation Modal

Before posting, a warning modal appears:

**Warning Message:**
> "This creates a permanent adjusting journal entry and cannot be edited or deleted"

**Details Shown:**
- Period name
- Entry date
- Description
- Number of lines
- Total debits and credits

**Required Checkbox:**
- "I understand that this action creates a permanent adjusting journal entry and is auditable"
- Submit button is disabled until checkbox is checked

**Actions:**
- **Cancel** - Closes modal, returns to form
- **Apply** - Proceeds with posting

#### After Apply

- Redirects to General Ledger view showing the newly created journal entry
- Entry is **read-only** - no edit or delete options
- Entry is marked with `reference_type = 'adjustment'` for filtering

### Approval Workflow (Future Enhancement)

For firm users, the system supports a **draft → approved → posted** lifecycle:

1. **Draft Creation:**
   - Junior accountant creates adjustment in draft status
   - Draft is saved but not posted to ledger
   - Can be edited until approved

2. **Partner/Senior Approval:**
   - Senior or Partner reviews draft
   - Can approve (moves to approved status) or reject
   - Approved adjustments can be posted

3. **Posting:**
   - Only approved adjustments can be posted to ledger
   - Posting creates permanent journal entry
   - Cannot be edited or deleted

**Problem It Solves:** Prevents junior staff from posting significant adjustments without review, ensuring quality control and audit trail.

---

## 4. Import & Reconciliation UI

### Problem It Solves
Accountants often need to import large volumes of historical data (opening balances, bank transactions, trial balances) from external systems. Manual entry of 100+ transactions is time-consuming and error-prone. The import UI needs to:
1. Handle CSV files efficiently
2. Validate data before posting
3. Provide "Quick Post" capability for bulk categorization

### CSV Import Workflow

#### Opening Balance Import (`/accounting/opening-balances`)

**1. Period Selection**
- Dropdown showing only **open** periods
- Accountant selects the period for which opening balances will be applied

**2. Equity Offset Account Selection**
- Dropdown to select an equity account (e.g., "Retained Earnings")
- **Purpose:** Opening balances must balance - the equity account offsets any imbalance
- **Validation:** Selected account must be of type "equity"

**3. Account Lines Table**

A dynamic table for entering opening balance lines:

- **Add Line Button** - Adds new row
- **Account Picker** - Searchable dropdown to select account
- **Amount Input** - Number input (positive or negative)
- **Auto-Derive Debit/Credit:**
  - For **Assets:** Positive amount = debit, negative = credit
  - For **Liabilities/Equity:** Positive amount = credit, negative = debit
- **Remove Button** - Removes line

- **Running Totals:**
  - Shows total debits and total credits
  - **Balance Check:**
    - ✓ **Balanced** (green) when debits = credits
    - **Imbalance: X.XX** (red) when debits ≠ credits

**4. Optional Note Field**
- Text area for additional documentation about the opening balance

**5. Apply Button**
- Disabled until:
  - Period selected
  - Equity offset account selected
  - At least one line with account and amount
  - No duplicate accounts in lines
  - Equity offset account not in lines
  - **Balanced** (debits = credits)

**6. Confirmation Modal**
Similar to adjustment workflow - warns that opening balance is permanent and auditable.

#### CSV Import for Bank Transactions (`/reconciliation/[accountId]/import`)

**1. File Upload**
- File picker to select CSV file
- Supported format: CSV with columns: `date`, `description`, `amount`, `reference` (optional)

**2. CSV Parsing**
- System automatically parses CSV
- Validates required columns exist
- Displays parsed rows in preview table

**3. Mapping Interface** (if columns don't match expected names)
- Column mapping dropdowns:
  - Date column → maps to `date`
  - Description column → maps to `description`
  - Amount column → maps to `amount`
  - Reference column → maps to `reference` (optional)

**4. Transaction Preview Table**
- Shows first 10-20 rows from CSV
- Columns: Date, Description, Amount, Type (Debit/Credit)
- **Type Determination:** 
  - Positive amount = Credit (money coming in)
  - Negative amount = Debit (money going out)

**5. Validation Display**
- Shows count of valid vs invalid rows
- Highlights rows with errors (invalid date, missing amount, etc.)
- **Error Messages:** Clear explanations for each validation failure

**6. Import Button**
- Bulk inserts all valid transactions
- Creates `bank_transactions` records with status "unreconciled"
- Shows success message with count of imported transactions

### "Quick Post" UI

**Problem It Solves:** When importing 100+ bank transactions, accountants need a fast way to categorize each transaction without opening individual forms.

#### Quick Post Interface (Conceptual - Based on External Ledger Mode)

The Quick Post UI would provide a table-based bulk editing interface:

**1. Transaction List Table**
- Columns: Date, Description, Amount, **Account** (editable), **Memo** (editable), Status
- Each row is a transaction from the import
- **Default Account:** System suggests likely account based on description patterns

**2. Bulk Actions**
- **Select All** checkbox - Select all transactions
- **Bulk Categorize** - Apply same account to selected transactions
- **Filter by Account** - Show only uncategorized transactions

**3. Account Selection**
- **Searchable Dropdown** per row - Type to search account names/codes
- **Recent Accounts** - Shows last 5 used accounts for quick selection
- **Account Suggestions** - Based on description keywords (e.g., "Office Supplies" → "Office Expenses" account)

**4. Validation**
- **Real-time Balance Check** - Shows running total and warns if out of balance
- **Duplicate Detection** - Highlights potential duplicate transactions
- **Date Range Validation** - Warns if transaction date is outside period

**5. Post Button**
- Bulk creates journal entries for all categorized transactions
- Shows progress bar for large imports (100+ transactions)
- Success message: "Posted X transactions successfully"

**Time Savings:** Instead of 2-3 minutes per transaction (opening form, selecting account, saving), Quick Post allows 10-15 seconds per transaction, saving 75-80% of time for large imports.

---

## 5. Reporting & Closing

### Problem It Solves
Accountants need reliable, ledger-based reports that reflect the true financial position. Reports must be:
1. **Period-Aware** - Respect accounting period boundaries
2. **Deterministic** - Same inputs = same outputs (for audits)
3. **Balanced** - Automatically detect and highlight imbalances
4. **Export-Ready** - Can be exported for external use

### Available Reports

All reports are accessed from the **Accounting Workspace Landing Page** under the "Financial Reports" section.

#### 1. Trial Balance (`/accounting/reports/trial-balance`)

**What It Shows:**
- All accounts with their balances for a selected period
- Grouped by account type (Assets, Liabilities, Equity, Income, Expenses)
- Debit and Credit columns
- Ending Balance column (signed based on account type)

**UI Elements:**

**Period Selector:**
- Dropdown of all accounting periods
- OR date range selector (start date, end date)
- Selected period is highlighted

**Balance Status Banner:**
- **✓ Balanced** (green banner) - Total debits = Total credits
- **⚠ Imbalance: X.XX** (red banner) - Total debits ≠ Total credits with difference amount

**Account Table:**
- Columns: Code, Name, Type, Debit, Credit, Balance
- Rows grouped by type with subtotals
- Expandable sections for each account type

**Totals Summary:**
- Total Debits
- Total Credits
- Total Assets
- Total Liabilities
- Total Equity
- Net Income (Income - Expenses)

**Export Button:**
- CSV Export
- Excel Export (with formatting)

**Problem It Solves:** Accountants can quickly verify the ledger is balanced before closing a period or preparing financial statements.

#### 2. Profit & Loss (`/accounting/reports/profit-and-loss`)

**What It Shows:**
- Revenue (income accounts) for a period
- Expenses (expense accounts) for a period
- Net Profit/Loss (Revenue - Expenses)
- Profit Margin (Net Profit / Revenue × 100%)

**UI Elements:**

**Period Selector:**
- Same as Trial Balance (period dropdown or date range)

**Revenue Section:**
- Green-themed table
- Columns: Account Code, Account Name, Amount
- Subtotal: Total Revenue

**Expenses Section:**
- Red-themed table
- Columns: Account Code, Account Name, Amount
- Subtotal: Total Expenses

**Net Profit/Loss Summary:**
- Large display of Net Profit/Loss
- **Green** if positive (profit)
- **Red** if negative (loss)
- Shows Profit Margin percentage

**Export Button:**
- CSV/Excel export

#### 3. Balance Sheet (`/accounting/reports/balance-sheet`)

**What It Shows:**
- Assets as of a specific date
- Liabilities as of a specific date
- Equity as of a specific date
- Balance Sheet equation: Assets = Liabilities + Equity

**UI Elements:**

**As-Of-Date Selector:**
- Date picker (defaults to today)
- OR select from period end dates

**Optional Period Selector:**
- For calculating current period net income to adjust equity

**Assets Section:**
- Blue-themed table
- Current Assets subsection
- Fixed Assets subsection
- Total Assets

**Liabilities Section:**
- Red-themed table
- Current Liabilities subsection
- Long-Term Liabilities subsection
- Total Liabilities

**Equity Section:**
- Green-themed table
- Retained Earnings
- Current Period Net Income (if period selected)
- Adjusted Equity
- Total Equity

**Balance Check Banner:**
- **✓ Balanced** (green) - Assets = Liabilities + Equity
- **⚠ Imbalance: X.XX** (red) - Assets ≠ Liabilities + Equity with difference

**Export Button:**
- CSV/Excel export

#### 4. General Ledger Report (`/accounting/reports/general-ledger`)

**What It Shows:**
- Detailed journal entries for a selected account
- Running balance for the account
- Chronological transaction history

**UI Elements:**

**Account Selector:**
- Searchable dropdown of all accounts
- Shows account code and name

**Period Selector:**
- Same as other reports

**Transaction Table:**
- Columns: Date, Description, Reference Type, Reference ID, Debit, Credit, Running Balance
- Sorted chronologically (date, then created_at)

**Summary:**
- Total Debit for period
- Total Credit for period
- Final Balance (ending balance)

**Export Button:**
- CSV/Excel export

### Period Closing Screen

**Problem It Solves:** Accountants need a clear, step-by-step process to close accounting periods, with visibility into what's blocking the close and how to resolve blockers.

#### Period Management Page (`/accounting/periods`)

**Period List Table:**

Each period row shows:

1. **Period Header:**
   - Period name (e.g., "January 2024")
   - Status badge:
     - **Open** (green) - Period is active
     - **Soft Closed** (yellow) - Period is closed but can be reopened
     - **🔒 Locked** (red, bold) - Period is permanently locked

2. **Period Details:**
   - Start Date: "January 1, 2024"
   - End Date: "January 31, 2024"
   - Closed By: User name/email (if closed)
   - Closed At: Timestamp (if closed)

3. **Action Buttons:**
   - **Close** button (blue) - For open periods (moves to soft_closed)
   - **Lock** button (red) - For soft_closed periods (moves to locked, permanent)
   - **Reopen** button (gray) - For soft_closed periods (admin only, requires reason)
   - **No Actions** text - For locked periods (cannot be changed)

#### Period Closing Workflow

**Step 1: Soft Close (Open → Soft Closed)**

When accountant clicks **Close** button:

1. **Validation Runs:** System checks for blockers:
   - Suspense account balance ≠ 0
   - Unapproved proposals exist
   - Ledger imbalances exist
   - Tax lines unmapped

2. **If Blockers Exist:**
   - **Error Modal Appears:**
     - Title: "Cannot Close Period"
     - **Blockers List:**
       - "❌ Suspense balance is not zero: 1,234.56"
       - "❌ Unapproved proposals exist: 3"
       - "❌ Ledger imbalances detected: 5 accounts"
       - "❌ Unresolved tax lines: 12"
     - **Action:** Accountant must resolve blockers before closing
     - **Cancel Button** - Dismisses modal

3. **If No Blockers:**
   - **Confirmation Modal:**
     - Message: "Close period January 2024? This will prevent new entries from being posted to this period."
     - **Confirm Button** - Proceeds with soft close
     - **Cancel Button** - Dismisses modal
   - Period status changes to **Soft Closed**
   - "Closed By" and "Closed At" fields are populated

**Step 2: Lock Period (Soft Closed → Locked)**

When accountant clicks **Lock** button (only visible for soft_closed periods):

1. **Final Validation:**
   - Re-checks all blockers
   - **Snapshot Integrity Check:**
     - Verifies snapshot balances match ledger-derived values
     - Checks for mismatches (usually indicates mapping/suspense issues)

2. **If Validation Fails:**
   - **Error Modal:**
     - Title: "Cannot Lock Period"
     - **Detailed Error:**
       - "Cannot lock period: Snapshot integrity check failed. Snapshots do not match ledger-derived values. Mismatches: Account 1000 (Cash): Snapshot shows 5,000.00, Ledger shows 5,100.00"
     - **Action:** Accountant must investigate and fix mismatches

3. **If Validation Passes:**
   - **Final Confirmation Modal:**
     - **⚠️ Warning Banner (red):**
       > "⚠️ Locking a period makes it PERMANENT. No entries can be posted to this period, and it cannot be reopened. This action is auditable and irreversible."
     - **Period Details:**
       - Period: January 2024
       - Status: Soft Closed → 🔒 Locked
     - **Required Checkbox:**
       - "I understand that locking this period is permanent and irreversible"
     - **Lock Button** (red) - Disabled until checkbox checked
     - **Cancel Button** - Dismisses modal
   - Period status changes to **🔒 Locked**
   - Period becomes read-only

#### Blockers Display

**Problem It Solves:** Accountants need clear visibility into what's preventing period closure, with specific actionable information.

**Blockers are displayed in the error modal as a bulleted list:**

1. **Suspense Account Balance:**
   - Message: "Suspense balance is not zero: 1,234.56"
   - **Resolution:** Accountant must move suspense balance to appropriate accounts

2. **Unapproved Proposals:**
   - Message: "Unapproved proposals exist: 3"
   - **Resolution:** Accountant must approve or reject pending proposals

3. **Ledger Imbalances:**
   - Message: "Ledger imbalances detected: 5 accounts"
   - **Resolution:** Accountant must review and correct imbalanced accounts

4. **Unresolved Tax Lines:**
   - Message: "Unresolved tax lines: 12"
   - **Resolution:** Accountant must map tax lines to appropriate accounts

Each blocker message is specific and actionable, telling the accountant exactly what needs to be fixed.

#### Reopen Workflow (Soft Closed Only)

For soft_closed periods, admins can click **Reopen** button:

1. **Reopen Modal Appears:**
   - **Warning Banner (yellow):**
     > "⚠️ Reopening a period allows new postings. This action is auditable and requires a reason."

2. **Required Fields:**
   - **Reason Textarea:** Cannot submit empty
   - Placeholder: "Explain why this period needs to be reopened..."

3. **Validation:**
   - Submit button disabled if reason is empty

4. **Actions:**
   - **Confirm Reopen** - Proceeds with reopen
   - **Cancel** - Dismisses modal

5. Period status changes back to **Open**
   - Reopen is logged in activity log with reason

**Problem It Solves:** Allows corrections to closed periods when necessary, with audit trail documenting why the reopen was necessary.

---

## Summary

The Accountant-First workspace provides a focused, audit-safe environment for managing client accounting:

1. **Firm Dashboard** - Multi-client overview with status indicators and quick actions
2. **Accounting Workspace** - Clean interface showing only accounting features (no operational clutter)
3. **Adjustment Workflow** - Permanent, auditable journal entries with approval workflows
4. **Import & Reconciliation** - Efficient CSV import with bulk categorization support
5. **Reporting & Closing** - Period-aware, deterministic reports with clear blocker visibility

Each feature is designed to solve specific accountant pain points: multi-client management, data accuracy, audit compliance, and time efficiency.

---

**Related Files:**
- `app/accounting/firm/page.tsx` - Firm Dashboard UI
- `app/accounting/page.tsx` - Accounting Workspace Landing Page
- `app/accounting/adjustments/page.tsx` - Adjustment Creation UI
- `app/accounting/opening-balances/page.tsx` - Opening Balance Import UI
- `app/accounting/periods/page.tsx` - Period Management UI
- `app/accounting/reports/*` - Financial Reports UI
- `components/Sidebar.tsx` - Dynamic Sidebar Navigation
