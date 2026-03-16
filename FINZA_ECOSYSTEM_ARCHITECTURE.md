# Finza Ecosystem Architecture: Three-Pillar Brain Dump

**Document Version:** 1.0  
**Date:** 2025-01-17  
**Author:** Lead Software Architect  
**Classification:** Technical architecture documentation

---

## EXECUTIVE SUMMARY

The Finza ecosystem is built on three interconnected pillars:

1. **POS/Retail Engine** - Real-time transaction processing for physical sales
2. **Service Mode (Invoicing)** - Professional service billing and collections
3. **Accountant-First Workspace** - Financial oversight and period management

All three modes feed into a **unified ledger** (double-entry accounting) that serves as the single source of truth for all financial statements. The system enforces **period locking**, **immutability**, and **canonical reporting** to ensure accounting integrity.

---

## 1. THE POS/RETAIL ENGINE

### 1.1 Event Trigger Logic: Sale Completion → Auto-Post to Ledger

#### Business Logic (Non-Technical Summary)
When a cashier completes a sale in the POS terminal, the system:
1. Creates a sale record (stored in `sales` table)
2. Deducts inventory from stock (if applicable)
3. **Automatically posts to the ledger** - No manual step required
4. Creates journal entries with multiple lines:
   - Cash received (debit)
   - Revenue recognized (credit)
   - COGS expense (debit) - if inventory items sold
   - Inventory reduction (credit) - if inventory items sold
   - Tax payable (credit) - if taxes applied

**The ledger posting happens automatically - cashiers don't need to do anything accounting-related.**

#### Technical Flow

**Step 1: Sale Creation (Frontend)**
- **File:** `app/(dashboard)/pos/page.tsx`
- **Function:** `handleCompletePayment()` (lines 1812-2072)
- **Action:** User completes payment in POS, frontend calls `/api/sales/create`

**Step 2: Sale Record Creation (Backend)**
- **File:** `app/api/sales/create/route.ts`
- **Function:** `POST()` (lines 25-1160)
- **Action:** Creates `sales` record and `sale_items` records
- **Tables Touched:**
  - `sales` (INSERT)
  - `sale_items` (INSERT for each item)
  - `products_stock` (UPDATE - inventory decrement)

**Step 3: Auto-Post to Ledger (Database Function)**
- **File:** `supabase/migrations/162_complete_sale_ledger_postings.sql`
- **Function:** `post_sale_to_ledger(p_sale_id UUID)` (lines 75-255)
- **Trigger:** **NO DATABASE TRIGGER** - explicitly called from API route
- **Location in API:** `app/api/sales/create/route.ts` (line ~1070)
  ```typescript
  const { data: journalEntryId } = await supabase.rpc("post_sale_to_ledger", {
    p_sale_id: sale.id,
  })
  ```

**Step 4: Journal Entry Creation**
- **Function:** `post_sale_to_ledger()` calls `post_journal_entry()`
- **Tables Touched:**
  - `journal_entries` (INSERT with `reference_type = 'sale'`, `reference_id = sale.id`)
  - `journal_entry_lines` (INSERT multiple lines)

#### Core Files

| Component | File | Purpose |
|-----------|------|---------|
| POS Frontend | `app/(dashboard)/pos/page.tsx` | User interface for completing sales |
| Sale Creation API | `app/api/sales/create/route.ts` | Creates sale record, calls ledger posting |
| Ledger Posting Function | `supabase/migrations/162_complete_sale_ledger_postings.sql` | Posts sale to ledger (COGS + Inventory) |
| Double-Entry Validation | `supabase/migrations/088_hard_db_constraints_ledger.sql` | Triggers validate debits = credits |

---

### 1.2 Partial Payments & Credit Sales: Ledger Balance Guarantee

#### Business Logic (Non-Technical Summary)
**Retail sales in Finza are always cash sales** - partial payments and credit sales are handled in **Service Mode (invoicing)**, not POS.

**In POS:**
- Sales are completed immediately with full payment
- Payment methods: Cash, MoMo, Card, or Split (multiple methods)
- All POS sales post to **Cash account** (debit), not Accounts Receivable
- **Ledger stays balanced** because sale amount = payment amount (no outstanding balance)

**If you need credit sales:**
- Use **Service Mode** to create an invoice
- Invoice posts to **Accounts Receivable** (debit) instead of Cash
- Customer can make partial payments later
- Each payment reduces AR balance (credit AR, debit Cash/Bank)

#### Technical Implementation

**POS Sales (Always Cash):**
- **File:** `supabase/migrations/162_complete_sale_ledger_postings.sql`
- **Function:** `post_sale_to_ledger()` (lines 186-191)
- **Ledger Lines:**
  ```sql
  -- Debit Cash (always)
  'account_id', cash_account_id,
  'debit', sale_record.amount,
  
  -- Credit Revenue
  'account_id', revenue_account_id,
  'credit', subtotal,
  ```

**Service Mode Credit Sales (AR-based):**
- **File:** `supabase/migrations/043_accounting_core.sql`
- **Function:** `post_invoice_to_ledger()` (lines 191-257)
- **Ledger Lines:**
  ```sql
  -- Debit AR (not Cash)
  'account_id', ar_account_id,
  'debit', invoice_record.total,
  
  -- Credit Revenue
  'account_id', revenue_account_id,
  'credit', subtotal,
  ```

**Partial Payments (Service Mode only):**
- **File:** `supabase/migrations/100_control_account_resolution.sql`
- **Function:** `post_invoice_payment_to_ledger()` (lines 792-846)
- **Ledger Lines:**
  ```sql
  -- Debit Cash/Bank (payment received)
  'account_id', asset_account_id, -- Cash/Bank/MoMo based on method
  'debit', payment_amount, -- NOT invoice.total, but payment.amount
  
  -- Credit AR (reduces receivable)
  'account_id', ar_account_id,
  'credit', payment_amount, -- Must match debit for balance
  ```

**Balance Guarantee:**
- Each journal entry validates `ABS(total_debit - total_credit) <= 0.01`
- Trigger: `enforce_double_entry_balance()` blocks unbalanced entries
- **File:** `supabase/migrations/088_hard_db_constraints_ledger.sql` (lines 76-112)

---

### 1.3 Real-Time COGS (Cost of Goods Sold) Calculation

#### Business Logic (Non-Technical Summary)
When a sale includes inventory items (products with stock tracking):
1. **System captures cost price** at time of sale (snapshot from product)
2. **Calculates COGS** = cost_price × quantity for each item
3. **Posts to ledger simultaneously** with revenue recognition:
   - Debit: COGS Expense (5000) - increases expense
   - Credit: Inventory Asset (1200) - decreases asset
4. **Inventory is decremented** from `products_stock` table (per-store tracking)

**COGS is calculated and posted automatically - no manual entry required.**

#### Technical Flow

**Step 1: COGS Calculation at Sale Creation**
- **File:** `app/api/sales/create/route.ts`
- **Lines:** 460-738 (stock deduction loop)
- **Process:**
  1. For each `sale_item`, get product `cost_price` from `products` table
  2. Calculate `cogs = cost_price × quantity`
  3. Store in `sale_items.cogs` column (snapshot)
  4. Update `products_stock` (decrement quantity)

**Step 2: COGS Aggregation in Ledger Posting**
- **File:** `supabase/migrations/162_complete_sale_ledger_postings.sql`
- **Function:** `post_sale_to_ledger()` (lines 119-123)
- **Calculation:**
  ```sql
  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0)
  INTO total_cogs
  FROM sale_items
  WHERE sale_id = p_sale_id;
  ```

**Step 3: COGS Journal Entry Lines**
- **File:** `supabase/migrations/162_complete_sale_ledger_postings.sql`
- **Function:** `post_sale_to_ledger()` (lines 197-206)
- **Ledger Lines:**
  ```sql
  -- Debit COGS Expense (5000)
  jsonb_build_object(
    'account_id', cogs_account_id, -- Account 5000
    'debit', total_cogs,
    'description', 'Cost of goods sold'
  ),
  -- Credit Inventory Asset (1200)
  jsonb_build_object(
    'account_id', inventory_account_id, -- Account 1200
    'credit', total_cogs,
    'description', 'Inventory reduction'
  )
  ```

**Key Point:** COGS and Inventory are posted **in the same journal entry** as Revenue and Cash. All lines are created atomically (transaction-safe).

#### Core Files

| Component | File | Purpose |
|-----------|------|---------|
| Stock Deduction | `app/api/sales/create/route.ts` (lines 460-738) | Deducts inventory, captures COGS snapshot |
| COGS Ledger Posting | `supabase/migrations/162_complete_sale_ledger_postings.sql` | Aggregates COGS and posts to ledger |
| COGS Table Schema | `supabase/migrations/021_cogs_tracking.sql` | Adds `cost_price` and `cogs` columns to `sale_items` |

---

## 2. THE SERVICE MODE (INVOICING)

### 2.1 Workflow: Invoice Creation → Payment

#### Business Logic (Non-Technical Summary)
**Service Mode workflow:**
1. **Create Invoice** (draft or sent)
   - Invoice posts to **Accounts Receivable** (AR) - customer owes you
   - Revenue is recognized immediately (even if not paid yet)
   - Tax is calculated and posted to Tax Payable accounts
2. **Send Invoice** (status changes to `'sent'`)
   - **Auto-posted to ledger** via database trigger
   - No manual ledger entry required
3. **Customer Makes Payment** (partial or full)
   - Each payment reduces AR balance
   - Cash/Bank account increases
   - **Auto-posted to ledger** via database trigger
4. **Invoice Status Updates** (automatically)
   - `'sent'` → if no payments
   - `'partially_paid'` → if payments < total
   - `'paid'` → if payments ≥ total

**The ledger automatically stays balanced because each payment reduces AR by the exact payment amount.**

#### Technical Flow

**Step 1: Invoice Creation**
- **File:** `app/api/invoices/create/route.ts`
- **Function:** `POST()` (lines 12-473)
- **Tables Touched:**
  - `invoices` (INSERT)
  - `invoice_items` (INSERT for each line)
- **Tax Calculation:**
  - Uses canonical tax engine: `getCanonicalTaxResultFromLineItems()`
  - Calculates taxes from `tax_lines` JSONB
  - Stores in `invoices.tax_lines` (canonical format)

**Step 2: Auto-Post to Ledger (Invoice)**
- **File:** `supabase/migrations/043_accounting_core.sql`
- **Trigger:** `trigger_auto_post_invoice` (lines 928-952)
- **Trigger Function:** `trigger_post_invoice()` (lines 929-945)
- **Fires:** AFTER INSERT or UPDATE of `status` on `invoices` table
- **Condition:** `status IN ('sent', 'paid', 'partially_paid')` AND wasn't already posted
- **Function Called:** `post_invoice_to_ledger(p_invoice_id)`
- **Location:** `supabase/migrations/172_phase12b_backfill_completion_compatibility.sql` (lines 78-236)

**Step 3: Invoice Ledger Posting**
- **Function:** `post_invoice_to_ledger()` creates journal entry:
  ```sql
  -- Debit AR (1100)
  -- Credit Revenue (4000)
  -- Credit Tax Payable (2100-2130, 2200+) - from tax_lines JSONB
  ```

**Step 4: Payment Creation**
- **File:** `app/api/payments/create/route.ts`
- **Function:** `POST()` (lines 7-254)
- **Tables Touched:**
  - `payments` (INSERT with `invoice_id`, `amount`, `method`, `date`)

**Step 5: Auto-Post to Ledger (Payment)**
- **File:** `supabase/migrations/043_accounting_core.sql`
- **Trigger:** `trigger_auto_post_payment` (lines 972-976)
- **Trigger Function:** `trigger_post_payment()` (lines 955-969)
- **Fires:** AFTER INSERT on `payments` table
- **Function Called:** `post_invoice_payment_to_ledger(p_payment_id)`
- **Location:** `supabase/migrations/172_phase12b_backfill_completion_compatibility.sql` (lines 414-542)

**Step 6: Payment Ledger Posting**
- **Function:** `post_invoice_payment_to_ledger()` creates journal entry:
  ```sql
  -- Debit Cash/Bank/MoMo (based on payment.method)
  -- Credit AR (1100) - reduces receivable
  ```

**Step 7: Invoice Status Recalculation**
- **File:** `supabase/migrations/129_fix_invoice_status_sync.sql`
- **Function:** `recalculate_invoice_status(p_invoice_id)`
- **Trigger:** Fires after payment INSERT/UPDATE
- **Calculation:**
  ```sql
  outstanding_amount = invoice.total - SUM(payments.amount) - SUM(credit_notes.total)
  status = 'paid' IF outstanding_amount = 0
  status = 'partially_paid' IF outstanding_amount > 0 AND payments > 0
  status = 'sent' IF outstanding_amount = invoice.total
  ```

#### Core Files

| Component | File | Purpose |
|-----------|------|---------|
| Invoice Creation API | `app/api/invoices/create/route.ts` | Creates invoice, calculates taxes |
| Invoice Ledger Trigger | `supabase/migrations/043_accounting_core.sql` (lines 928-952) | Auto-posts invoice to ledger when sent |
| Invoice Ledger Function | `supabase/migrations/172_phase12b_backfill_completion_compatibility.sql` | Posts invoice to ledger (AR + Revenue + Tax) |
| Payment Creation API | `app/api/payments/create/route.ts` | Creates payment record |
| Payment Ledger Trigger | `supabase/migrations/043_accounting_core.sql` (lines 972-976) | Auto-posts payment to ledger |
| Payment Ledger Function | `supabase/migrations/172_phase12b_backfill_completion_compatibility.sql` | Posts payment to ledger (Cash/Bank + AR) |
| Status Recalculation | `supabase/migrations/129_fix_invoice_status_sync.sql` | Updates invoice status from payments/credits |

---

### 2.2 Tax/VAT Splits for Professional Service Invoices

#### Business Logic (Non-Technical Summary)
**Tax calculation for invoices:**
1. **Tax Engine** calculates all taxes (NHIL, GETFund, COVID, VAT) from line items
2. **Taxes are split** into separate ledger accounts:
   - VAT → Account 2100 (VAT Payable)
   - NHIL → Account 2110 (NHIL Payable)
   - GETFund → Account 2120 (GETFund Payable)
   - COVID → Account 2130 (COVID Payable)
3. **Each tax posts to its own liability account** (credit side)
4. **Tax metadata stored** in `tax_lines` JSONB for audit trail

**Tax splits happen automatically - no manual allocation required.**

#### Technical Implementation

**Step 1: Tax Calculation (Canonical Tax Engine)**
- **File:** `app/api/invoices/create/route.ts`
- **Lines:** 201-236
- **Function:** `getCanonicalTaxResultFromLineItems(lineItems, config)`
- **Engine:** `lib/taxEngine/index.ts` (canonical tax engine)
- **Output:** `TaxResult` with:
  - `base_amount` (subtotal before tax)
  - `total_tax` (sum of all taxes)
  - `total_amount` (subtotal + taxes)
  - `lines[]` (array of tax line items with `code`, `amount`, `ledger_account_code`, `ledger_side`)

**Step 2: Tax Storage (Canonical Format)**
- **File:** `app/api/invoices/create/route.ts`
- **Lines:** 276-314
- **Storage:**
  ```typescript
  tax_lines: toTaxLinesJsonb(taxResult.lines), // JSONB canonical format
  tax_engine_code: taxEngineCode,
  tax_engine_effective_from: effectiveDateForCalculation,
  tax_jurisdiction: countryCode,
  ```

**Step 3: Tax Ledger Posting (Split by Tax Type)**
- **File:** `supabase/migrations/172_phase12b_backfill_completion_compatibility.sql`
- **Function:** `post_invoice_to_ledger()` (lines 176-215)
- **Process:**
  ```sql
  -- Parse tax_lines JSONB
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := line_meta->>'ledger_account_code'; -- e.g., '2100', '2110'
    tax_amount := tax_line_item->>'amount';
    
    -- Post each tax to its own account
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', tax_account_id, -- Account from ledger_account_code
        'credit', tax_amount, -- Taxes are liabilities (credit)
        'description', tax_code || ' tax' -- 'VAT tax', 'NHIL tax', etc.
      )
    );
  END LOOP;
  ```

**Example Journal Entry for Taxed Invoice:**
```
Debit:  AR (1100)              GHS 1,219.00
Credit: Revenue (4000)         GHS 1,000.00
Credit: VAT Payable (2100)     GHS   150.00
Credit: NHIL Payable (2110)    GHS    25.00
Credit: GETFund Payable (2120) GHS    25.00
Credit: COVID Payable (2130)   GHS    10.00
                                --------
Total Credits = GHS 1,219.00 ✅ (Balanced)
```

#### Core Files

| Component | File | Purpose |
|-----------|------|---------|
| Tax Calculation | `lib/taxEngine/index.ts` | Canonical tax engine (multi-country) |
| Tax Serialization | `lib/taxEngine/serialize.ts` | Converts TaxResult to JSONB format |
| Invoice Tax Posting | `supabase/migrations/172_phase12b_backfill_completion_compatibility.sql` | Posts taxes to separate liability accounts |

---

### 2.3 Service Mode ↔ General Ledger Relationship

#### Business Logic (Non-Technical Summary)
**Service Mode operations directly feed the General Ledger:**

1. **Invoice Creation** → Creates journal entry:
   - Debit: Accounts Receivable (customer owes you)
   - Credit: Revenue (income recognized)
   - Credit: Tax Payable (taxes collected)

2. **Payment Received** → Creates journal entry:
   - Debit: Cash/Bank (money received)
   - Credit: Accounts Receivable (reduces what customer owes)

3. **Credit Note Applied** → Creates reversing journal entry:
   - Debit: Revenue (reduces income)
   - Debit: Tax Payable (reduces tax liability)
   - Credit: Accounts Receivable (reduces what customer owes)

**All Service Mode transactions are automatically posted to the General Ledger - no manual journal entries needed.**

#### Technical Architecture

**Ledger Integration Points:**

1. **Invoices → Ledger (Auto-Trigger)**
   - **Trigger:** `trigger_auto_post_invoice` (fires on invoice status change to `'sent'`)
   - **Function:** `post_invoice_to_ledger(p_invoice_id)`
   - **Reference:** `journal_entries.reference_type = 'invoice'`, `reference_id = invoice.id`

2. **Payments → Ledger (Auto-Trigger)**
   - **Trigger:** `trigger_auto_post_payment` (fires on payment INSERT)
   - **Function:** `post_invoice_payment_to_ledger(p_payment_id)`
   - **Reference:** `journal_entries.reference_type = 'payment'`, `reference_id = payment.id`

3. **Credit Notes → Ledger (Auto-Trigger)**
   - **Trigger:** `trigger_auto_post_credit_note` (fires on credit note status = `'applied'`)
   - **Function:** `post_credit_note_to_ledger(p_credit_note_id)`
   - **Reference:** `journal_entries.reference_type = 'credit_note'`, `reference_id = credit_note.id`

**Ledger Tables:**

- `journal_entries` - Header records (one per invoice, payment, credit note)
- `journal_entry_lines` - Debit/credit lines (multiple per journal entry)
- `accounts` - Chart of Accounts (AR=1100, Revenue=4000, Tax=2100-2130)

**Query Example:**
```sql
-- See all journal entries for an invoice
SELECT * FROM journal_entries 
WHERE reference_type = 'invoice' 
  AND reference_id = '<invoice_id>';

-- See all ledger lines for an invoice
SELECT jel.*, a.code, a.name 
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
JOIN accounts a ON a.id = jel.account_id
WHERE je.reference_type = 'invoice' 
  AND je.reference_id = '<invoice_id>';
```

#### Core Files

| Component | File | Purpose |
|-----------|------|---------|
| Ledger Triggers | `supabase/migrations/043_accounting_core.sql` (lines 924-1051) | Auto-posting triggers for invoices, payments, credit notes |
| General Ledger Schema | `supabase/migrations/043_accounting_core.sql` (lines 28-62) | `journal_entries` and `journal_entry_lines` table definitions |

---

## 3. THE ACCOUNTANT-FIRST WORKSPACE (THE BRAIN)

### 3.1 Oversight Without Interference: Read-Only Architecture

#### Business Logic (Non-Technical Summary)
**The Accountant-First Workspace is the "brain" that oversees POS and Service modes without interfering:**

1. **Read-Only Financial Reports:**
   - Trial Balance (all accounts with balances)
   - Profit & Loss (income and expenses)
   - Balance Sheet (assets, liabilities, equity)
   - **All reports read from the ledger only** - no direct access to sales/invoices

2. **Period Management:**
   - Accountants can lock periods (prevent new transactions)
   - Cannot modify existing transactions (ledger is immutable)
   - Can create adjustments in soft-closed periods only

3. **Data Flow:**
   ```
   POS Sales → Ledger (journal_entries)
   Service Invoices → Ledger (journal_entries)
                            ↓
                    Trial Balance Snapshot
                            ↓
              P&L / Balance Sheet Reports
   ```

**Accountants can see everything but cannot interfere with daily operations once periods are locked.**

#### Technical Architecture

**Read-Only Reporting Functions:**
- **File:** `supabase/migrations/169_trial_balance_canonicalization.sql`
- **Functions:**
  - `get_trial_balance_from_snapshot(p_period_id)` - Returns trial balance from snapshot
  - `get_profit_and_loss_from_trial_balance(p_period_id)` - P&L from trial balance only
  - `get_balance_sheet_from_trial_balance(p_period_id)` - Balance Sheet from trial balance only

**Key Point:** Financial statements **do not query sales or invoices directly**. They consume the **Trial Balance snapshot**, which is derived from the ledger only.

**Enforcement:**
- **File:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 340-363)
- **Function:** `assert_statement_uses_trial_balance(p_function_name)` - Warns if statements bypass Trial Balance

#### Core Files

| Component | File | Purpose |
|-----------|------|---------|
| Trial Balance Generator | `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 56-209) | Generates canonical trial balance snapshot |
| P&L Function | `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 270-301) | Returns P&L from trial balance only |
| Balance Sheet Function | `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 308-338) | Returns Balance Sheet from trial balance only |
| Report API Endpoints | `app/api/accounting/reports/*/route.ts` | API endpoints that call canonical functions |

---

### 3.2 Hard Period Locking Architecture

#### Business Logic (Non-Technical Summary)
**Period locking prevents changes to historical data:**

1. **Period Statuses:**
   - `'open'` - Accepts all transactions (sales, invoices, payments, adjustments)
   - `'soft_closed'` - Accepts adjustments only (no regular transactions)
   - `'locked'` - Accepts nothing (immutable forever)

2. **Locking Process:**
   - Accountant soft-closes period → `'open'` → `'soft_closed'` (allows adjustments)
   - Accountant locks period → `'soft_closed'` → `'locked'` (immutable)
   - **Once locked, period cannot be reopened** - no exceptions

3. **Enforcement Layers:**
   - **Application Level:** Posting functions check period status before posting
   - **Database Function Level:** `post_journal_entry()` validates period status
   - **Database Trigger Level:** `validate_period_open_for_entry()` blocks INSERT if period is locked

**Locked periods are immutable at ALL layers - impossible to bypass.**

#### Technical Implementation

**Layer 1: Application-Level Guards**
- **File:** `supabase/migrations/165_period_locking_posting_guards.sql`
- **Function:** `assert_accounting_period_is_open(p_business_id, p_date, p_is_adjustment)` (lines 21-47)
- **Called By:**
  - `post_sale_to_ledger()` (line 117 in migration 162)
  - `post_invoice_to_ledger()` (line 137 in migration 172)
  - `post_expense_to_ledger()` (line 304 in migration 172)
  - `post_journal_entry()` (line 127 in migration 165)

**Layer 2: Database Function-Level Guards**
- **File:** `supabase/migrations/165_period_locking_posting_guards.sql`
- **Function:** `post_journal_entry()` (lines 109-167)
- **Validation:**
  ```sql
  PERFORM assert_accounting_period_is_open(p_business_id, p_date);
  ```

**Layer 3: Database Trigger-Level Guards (Hard Enforcement)**
- **File:** `supabase/migrations/088_hard_db_constraints_ledger.sql`
- **Trigger:** `trigger_enforce_period_state_on_entry` (lines 247-251)
- **Trigger Function:** `validate_period_open_for_entry()` (lines 57-100 in migration 165)
- **Fires:** BEFORE INSERT on `journal_entries` table
- **Enforcement:**
  ```sql
  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Cannot insert journal entry into locked period...';
  END IF;
  ```

**Period Status Transitions:**
- **File:** `lib/accountingPeriods/lifecycle.ts`
- **Functions:**
  - `movePeriodToSoftClosed()` (lines 458-496) - `'open'` → `'soft_closed'`
  - `lockPeriod()` (lines 503-536) - `'soft_closed'` → `'locked'`
- **API Endpoints:**
  - `app/api/accounting/periods/close/route.ts` - Soft close period
  - `app/api/accounting/periods/lock/route.ts` - Lock period

**Immutability Enforcement:**
- **File:** `supabase/migrations/088_hard_db_constraints_ledger.sql`
- **Triggers:**
  - `prevent_journal_entry_modification()` (lines 42-52) - Blocks UPDATE/DELETE on `journal_entries`
  - `prevent_journal_entry_line_modification()` (lines 42-58) - Blocks UPDATE/DELETE on `journal_entry_lines`

#### Core Files

| Component | File | Purpose |
|-----------|------|---------|
| Period Status Guards | `supabase/migrations/165_period_locking_posting_guards.sql` | Application and function-level period checks |
| Database Triggers | `supabase/migrations/088_hard_db_constraints_ledger.sql` | Trigger-level period enforcement |
| Period Lifecycle | `lib/accountingPeriods/lifecycle.ts` | Period transition functions (soft close, lock) |
| Period API | `app/api/accounting/periods/close/route.ts`, `app/api/accounting/periods/lock/route.ts` | API endpoints for period management |

---

### 3.3 Annual Financial Statement (AFS) Engine: Data Aggregation

#### Business Logic (Non-Technical Summary)
**The AFS engine aggregates data from POS and Service modes to generate financial statements:**

1. **Data Source:**
   - **Trial Balance** (canonical snapshot) - aggregates all ledger entries
   - Ledger entries come from:
     - POS sales → `journal_entries` with `reference_type = 'sale'`
     - Service invoices → `journal_entries` with `reference_type = 'invoice'`
     - Payments → `journal_entries` with `reference_type = 'payment'`

2. **Financial Statements:**
   - **Profit & Loss:** Filters income/expense accounts from Trial Balance
   - **Balance Sheet:** Filters asset/liability/equity accounts from Trial Balance
   - **Both reconcile to Trial Balance** - guaranteed accuracy

3. **Notes to Financial Statements:**
   - Revenue breakdown: POS sales vs Service invoices (from `reference_type`)
   - Tax breakdown: Aggregated from `journal_entry_lines` where account codes 2100-2130
   - COGS: From account 5000 (only for POS sales)
   - Inventory: From account 1200 (only for POS sales)

**The AFS engine reads from the ledger only - it doesn't touch sales or invoices directly.**

#### Technical Implementation

**Step 1: Generate Trial Balance Snapshot**
- **File:** `supabase/migrations/169_trial_balance_canonicalization.sql`
- **Function:** `generate_trial_balance(p_period_id)` (lines 56-209)
- **Source Data:**
  ```sql
  -- Opening balances from period_opening_balances
  SELECT opening_balance FROM period_opening_balances
  WHERE period_id = p_period_id AND account_id = account_record.id;
  
  -- Period activity from journal_entry_lines
  SELECT SUM(jel.debit), SUM(jel.credit)
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = account_record.id
    AND je.date >= period_start AND je.date <= period_end;
  ```
- **Output:** Persists to `trial_balance_snapshots` table (JSONB array of account balances)

**Step 2: Generate Profit & Loss Statement**
- **File:** `supabase/migrations/169_trial_balance_canonicalization.sql`
- **Function:** `get_profit_and_loss_from_trial_balance(p_period_id)` (lines 270-301)
- **Process:**
  ```sql
  -- Get trial balance from snapshot
  FOR trial_balance_row IN
    SELECT * FROM get_trial_balance_from_snapshot(p_period_id)
    WHERE account_type IN ('income', 'expense')
  LOOP
    RETURN QUERY SELECT
      trial_balance_row.account_id,
      trial_balance_row.account_code,
      trial_balance_row.account_name,
      trial_balance_row.account_type,
      trial_balance_row.closing_balance; -- Period total
  END LOOP;
  ```

**Step 3: Generate Balance Sheet**
- **File:** `supabase/migrations/169_trial_balance_canonicalization.sql`
- **Function:** `get_balance_sheet_from_trial_balance(p_period_id)` (lines 308-338)
- **Process:**
  ```sql
  -- Get trial balance from snapshot
  FOR trial_balance_row IN
    SELECT * FROM get_trial_balance_from_snapshot(p_period_id)
    WHERE account_type IN ('asset', 'liability', 'equity')
  LOOP
    RETURN QUERY SELECT
      trial_balance_row.account_id,
      trial_balance_row.account_code,
      trial_balance_row.account_name,
      trial_balance_row.account_type,
      trial_balance_row.closing_balance; -- Ending balance
  END LOOP;
  ```

**Step 4: Notes to Financial Statements (Operational Breakdown)**
- **Revenue Breakdown (POS vs Service):**
  ```sql
  -- POS Revenue (from sales)
  SELECT SUM(jel.credit)
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE a.code = '4000' -- Revenue
    AND je.reference_type = 'sale'
    AND je.date >= period_start AND je.date <= period_end;
  
  -- Service Revenue (from invoices)
  SELECT SUM(jel.credit)
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE a.code = '4000' -- Revenue
    AND je.reference_type = 'invoice'
    AND je.date >= period_start AND je.date <= period_end;
  ```

- **COGS (POS Only):**
  ```sql
  SELECT SUM(jel.debit)
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE a.code = '5000' -- COGS
    AND je.reference_type = 'sale'
    AND je.date >= period_start AND je.date <= period_end;
  ```

- **Tax Breakdown:**
  ```sql
  SELECT a.code, a.name, SUM(jel.credit)
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE a.code IN ('2100', '2110', '2120', '2130') -- Tax accounts
    AND je.date >= period_start AND je.date <= period_end
  GROUP BY a.code, a.name;
  ```

#### Core Files

| Component | File | Purpose |
|-----------|------|---------|
| Trial Balance Generator | `supabase/migrations/169_trial_balance_canonicalization.sql` | Generates canonical snapshot from ledger |
| P&L Function | `supabase/migrations/169_trial_balance_canonicalization.sql` | Returns P&L from trial balance |
| Balance Sheet Function | `supabase/migrations/169_trial_balance_canonicalization.sql` | Returns Balance Sheet from trial balance |
| Reconciliation Validator | `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 371-448) | Validates statements reconcile to trial balance |

---

## INTERCONNECTION SUMMARY

### Data Flow Diagram

```
┌─────────────────┐         ┌─────────────────┐
│   POS MODE      │         │  SERVICE MODE   │
│                 │         │                 │
│  Sales          │         │  Invoices       │
│  + Stock        │         │  + Payments     │
│  Deduction      │         │  + Credit Notes │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │ post_sale_to_ledger()     │ post_invoice_to_ledger()
         │ post_payment_to_ledger()  │
         │                           │
         ▼                           ▼
    ┌─────────────────────────────────────────┐
    │         GENERAL LEDGER                  │
    │                                         │
    │  journal_entries                       │
    │  journal_entry_lines                   │
    │  (reference_type: 'sale', 'invoice',   │
    │   'payment', 'credit_note')            │
    └─────────────────────────────────────────┘
                     │
                     │ generate_trial_balance()
                     ▼
         ┌───────────────────────┐
         │  TRIAL BALANCE        │
         │  (Canonical Snapshot) │
         │  trial_balance_       │
         │  snapshots            │
         └───────────┬───────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
    ┌─────────────┐      ┌──────────────┐
    │  P&L        │      │ BALANCE SHEET│
    │  Statement  │      │  Statement   │
    └─────────────┘      └──────────────┘
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  ACCOUNTANT-FIRST     │
         │  WORKSPACE            │
         │                       │
         │  - Read-only reports  │
         │  - Period locking     │
         │  - Adjustments        │
         │  - AFS Generation     │
         └───────────────────────┘
```

### Key Architectural Principles

1. **Single Source of Truth:** Ledger (`journal_entries` + `journal_entry_lines`) is the only source for financial statements
2. **Automatic Posting:** POS and Service modes automatically post to ledger (triggers or explicit calls)
3. **Immutability:** Once posted, ledger entries cannot be modified (append-only)
4. **Period Locking:** Locked periods prevent new transactions (multi-layer enforcement)
5. **Canonical Reporting:** All financial statements consume Trial Balance snapshot only (no direct ledger queries)

---

## VERIFICATION QUERIES

### Verify POS Sales Posted to Ledger
```sql
SELECT 
  je.id,
  je.date,
  je.description,
  je.reference_type,
  COUNT(jel.id) as line_count,
  SUM(jel.debit) as total_debit,
  SUM(jel.credit) as total_credit
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
WHERE je.reference_type = 'sale'
  AND je.date >= '2024-01-01'
GROUP BY je.id, je.date, je.description, je.reference_type;
```

### Verify Service Invoices Posted to Ledger
```sql
SELECT 
  je.id,
  je.date,
  je.description,
  je.reference_type,
  COUNT(jel.id) as line_count,
  SUM(jel.debit) as total_debit,
  SUM(jel.credit) as total_credit
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
WHERE je.reference_type = 'invoice'
  AND je.date >= '2024-01-01'
GROUP BY je.id, je.date, je.description, je.reference_type;
```

### Verify Period Locking
```sql
SELECT 
  ap.id,
  ap.period_start,
  ap.status,
  COUNT(je.id) as journal_entries_count
FROM accounting_periods ap
LEFT JOIN journal_entries je ON je.business_id = ap.business_id
  AND je.date >= ap.period_start AND je.date <= ap.period_end
WHERE ap.status = 'locked'
GROUP BY ap.id, ap.period_start, ap.status;
```

---

**END OF DOCUMENT**
