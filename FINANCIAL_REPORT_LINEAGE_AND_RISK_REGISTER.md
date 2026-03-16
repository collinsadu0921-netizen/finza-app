# Financial Report Lineage Map & Accounting Risk Register

**Date:** 2026-01-27  
**Purpose:** Complete lineage mapping of all financial reports and accounting risk assessment

---

## Part 1: Report Lineage Map

### Report Name → Source Tables → Aggregation → Output Fields

#### ✅ LEDGER-BASED REPORTS (Accounting Workspace)

| Report Name | Route | Primary Source | Source Tables | Join Path | Aggregation | Output Fields |
|-------------|-------|----------------|---------------|-----------|-------------|---------------|
| **Trial Balance** | `/api/accounting/reports/trial-balance` | ✅ Journal | `trial_balance_snapshots` → `journal_entry_lines` → `accounts` | `trial_balance_snapshots.account_id = accounts.id` | SUM(debit), SUM(credit), closing_balance by account | Account code, name, type, debit_total, credit_total, closing_balance |
| **Profit & Loss** | `/api/accounting/reports/profit-and-loss` | ✅ Journal | `trial_balance_snapshots` → `journal_entry_lines` → `accounts` | Filter: `account_type IN ('income', 'expense')` | SUM(period_total) by account type | Revenue accounts, expense accounts, net profit, profit margin |
| **Balance Sheet** | `/api/accounting/reports/balance-sheet` | ✅ Journal | `trial_balance_snapshots` → `journal_entry_lines` → `accounts` | Filter: `account_type IN ('asset', 'liability', 'equity')` | SUM(balance) by account type, net income from P&L | Assets, liabilities, equity, adjusted equity, balancing check |
| **General Ledger** | `/api/accounting/reports/general-ledger` | ✅ Journal | `journal_entries` → `journal_entry_lines` → `accounts` | `journal_entry_lines.journal_entry_id = journal_entries.id`<br>`journal_entry_lines.account_id = accounts.id` | Running balance (window function), SUM(debit), SUM(credit) | Entry date, description, reference, debit, credit, running balance |

#### ⚠️ LEGACY REPORTS (Deprecated - Still Accessible)

| Report Name | Route | Primary Source | Source Tables | Join Path | Aggregation | Output Fields |
|-------------|-------|----------------|---------------|-----------|-------------|---------------|
| **Profit & Loss (Legacy)** | `/api/reports/profit-loss` | ✅ Journal | `trial_balance_snapshots` (via RPC) | Same as accounting version | Same as accounting version | Same as accounting version |
| **Balance Sheet (Legacy)** | `/api/reports/balance-sheet` | ✅ Journal | `trial_balance_snapshots` (via RPC) | Same as accounting version | Same as accounting version | Same as accounting version |
| **Trial Balance (Legacy)** | `/api/reports/trial-balance` | ✅ Journal | `trial_balance_snapshots` (via RPC) | Same as accounting version | Same as accounting version | Same as accounting version |

#### ❌ OPERATIONAL TABLE REPORTS (Non-Ledger)

| Report Name | Route | Primary Source | Source Tables | Join Path | Aggregation | Output Fields |
|-------------|-------|----------------|---------------|-----------|-------------|---------------|
| **Tax Summary** | `/api/reports/tax-summary` | ❌ Operational | `invoices`, `expenses`, `bills`, `sales`, `credit_notes` | No joins - separate queries | SUM(nhil), SUM(getfund), SUM(covid), SUM(vat) by source | Output tax, input tax, net tax, paid, pending |
| **Aging Report** | `/api/reports/aging` | ❌ Operational | `invoices` → `payments` → `customers` | `payments.invoice_id = invoices.id`<br>`invoices.customer_id = customers.id` | Outstanding = invoice.total - SUM(payments.amount) | Aging buckets (0-30, 31-60, 61-90, 90+), customer totals |
| **Sales Summary** | `/api/reports/sales-summary` | ❌ Operational | `invoices` → `credit_notes` | `credit_notes.invoice_id = invoices.id` | Revenue = SUM(invoices.total) - SUM(credit_notes.total) | Total revenue, subtotal, tax, paid revenue, pending revenue |
| **VAT Report** | `/app/reports/vat` | ❌ Operational | `sales` → `sale_items` → `products` → `categories` | `sale_items.sale_id = sales.id`<br>`sale_items.product_id = products.id`<br>`products.category_id = categories.id` | SUM(line_total) by VAT type, SUM(tax) from tax_lines | Standard-rated sales, zero-rated sales, exempt sales, tax totals |
| **Register Report** | `/app/reports/registers` | ❌ Operational | `sales` → `registers` | `sales.register_id = registers.id` | SUM(amount) by register, SUM(amount) by payment_method | Total sales, transaction count, cash/momo/card/hubtel/bank totals |
| **Analytics Dashboard** | `/app/admin/retail/analytics` | ❌ Operational | `sales` → `sale_items` → `cashier_sessions` → `registers` | `sale_items.sale_id = sales.id`<br>`sales.cashier_session_id = cashier_sessions.id`<br>`cashier_sessions.register_id = registers.id` | SUM(qty * price) for revenue, SUM(cogs) for COGS, SUM(amount) by session | Revenue, COGS, gross profit, VAT, session totals, payment breakdown |

---

## Part 2: Accounting Risk Register

### Risk Classification

**Risk Types:**
- **Completeness:** Report excludes transactions that should be included
- **Valuation:** Report uses incorrect amounts or calculations
- **Classification:** Report misclassifies transactions or accounts
- **Timing:** Report includes/excludes transactions in wrong period

**Severity:**
- **Blocking:** Financial integrity compromised, must fix immediately
- **Corrective:** Data consistency risk, should fix in short-term

---

### 🔴 BLOCKING RISKS

| Risk ID | Location | Risk Type | Description | Impact |
|---------|----------|-----------|-------------|--------|
| **R-001** | `app/api/reports/tax-summary/route.ts` | Completeness | Tax totals calculated from operational tables (`invoices`, `sales`, `expenses`, `bills`) instead of ledger VAT Payable account (2100) | Tax liability may not match ledger if journal entries are missing or incorrect |
| **R-002** | `app/api/reports/tax-summary/route.ts` | Valuation | Tax amounts extracted from `invoices.vat`, `sales.tax_lines`, `expenses.vat` instead of `journal_entry_lines` where `account_code = '2100'` | Tax calculations may be incorrect if operational table values are out of sync with ledger |
| **R-003** | `app/api/reports/aging/route.ts` | Completeness | Outstanding amounts calculated from `invoices.total - SUM(payments.amount)` instead of Accounts Receivable account balance | Outstanding may not match ledger if journal entries are missing or payments not posted |
| **R-004** | `app/api/reports/aging/route.ts` | Valuation | Uses `invoices.total` and `payments.amount` directly without ledger validation | Outstanding amounts may be incorrect if invoices/payments exist without corresponding journal entries |
| **R-005** | `app/api/reports/sales-summary/route.ts` | Completeness | Revenue calculated from `invoices.total - credit_notes.total` instead of Revenue account (4000) | Revenue may not match ledger if journal entries are missing |
| **R-006** | `app/api/reports/sales-summary/route.ts` | Valuation | Uses `invoices.total`, `invoices.subtotal_before_tax`, `invoices.total_tax_amount` directly | Revenue, subtotal, and tax may be incorrect if operational values don't match ledger |
| **R-007** | `app/reports/vat/page.tsx` | Completeness | VAT totals calculated from `sales.tax_lines` and `sale_items` instead of ledger VAT Payable account | VAT liability may not match ledger |
| **R-008** | `app/reports/vat/page.tsx` | Valuation | Sales totals calculated from `sale_items.price * qty` instead of Revenue account entries | Sales amounts may not match ledger if sale_items are out of sync |
| **R-009** | `app/reports/registers/page.tsx` | Completeness | Register totals calculated from `sales.amount` instead of `journal_entry_lines` grouped by register/session | Register totals may not match ledger if sales exist without journal entries |
| **R-010** | `app/reports/registers/page.tsx` | Valuation | Payment method breakdown uses `sales.payment_method` and `sales.amount` directly | Payment totals may be incorrect if sales are not properly posted to ledger |
| **R-011** | `app/admin/retail/analytics/page.tsx` | Completeness | Revenue calculated from `sale_items.qty * price` instead of Revenue account (4000) | Analytics revenue may not match ledger |
| **R-012** | `app/admin/retail/analytics/page.tsx` | Valuation | COGS calculated from `sale_items.cogs` instead of COGS account (5000) | COGS and gross profit may be incorrect if sale_items.cogs doesn't match ledger |
| **R-013** | `app/admin/retail/analytics/page.tsx` | Valuation | VAT calculated from `sales.tax_lines` instead of VAT Payable account (2100) | VAT totals may not match ledger |
| **R-014** | `app/admin/retail/analytics/page.tsx` | Completeness | Session totals calculated from `sales.amount` grouped by `cashier_session_id` instead of ledger entries | Session analytics may not match ledger if sales are not posted |
| **R-015** | `app/dashboard/page.tsx:400` | Completeness | Total revenue calculated from `payments.amount` instead of Revenue account (4000) | Dashboard revenue KPI may not match ledger |
| **R-016** | `app/dashboard/page.tsx:375-425` | Completeness | Outstanding amounts calculated from `invoices.total - payments - credit_notes` instead of Accounts Receivable balance | Outstanding KPI may not match ledger |
| **R-017** | `app/invoices/page.tsx:426-431` | Completeness | Total revenue calculated from `payments.amount` instead of Revenue account (4000) | Invoices page revenue may not match ledger |
| **R-018** | `lib/db/actions/register.ts:52-70` | Valuation | Expected cash calculated from `sales.cash_amount` and `sales.change_given` instead of Cash account (1000) entries | Register variance calculations may be incorrect if sales cash amounts don't match ledger |

---

### 🟡 CORRECTIVE RISKS

| Risk ID | Location | Risk Type | Description | Impact |
|---------|----------|-----------|-------------|--------|
| **R-019** | `app/api/reports/tax-summary/route.ts` | Timing | Tax calculations filter by `issue_date`/`created_at`/`date` from operational tables, not journal entry dates | Tax may be included in wrong period if operational dates don't match journal entry dates |
| **R-020** | `app/api/reports/aging/route.ts` | Timing | Aging buckets calculated from `invoices.due_date` and `invoices.issue_date`, not journal entry dates | Aging may be incorrect if invoice dates don't match when transactions were actually recorded |
| **R-021** | `app/api/reports/sales-summary/route.ts` | Timing | Revenue filtered by `invoices.issue_date`, not journal entry dates | Revenue may be in wrong period if invoice issue date doesn't match posting date |
| **R-022** | `app/reports/vat/page.tsx` | Timing | VAT report filters by `sales.created_at`, not journal entry dates | VAT may be in wrong period if sale creation date doesn't match posting date |
| **R-023** | `app/reports/registers/page.tsx` | Timing | Register report filters by `sales.created_at`, not journal entry dates | Register totals may be in wrong period |
| **R-024** | `app/admin/retail/analytics/page.tsx` | Timing | Analytics filters by `sales.created_at`, not journal entry dates | Analytics may show wrong period data |
| **R-025** | `app/api/reports/tax-summary/route.ts` | Classification | Tax breakdown by source (invoices, sales, expenses, bills) instead of by account code | Tax classification may not match chart of accounts structure |
| **R-026** | `app/reports/vat/page.tsx` | Classification | VAT type classification from `categories.vat_type` instead of account codes | VAT classification may not match ledger account structure |
| **R-027** | `app/api/customers/[id]/statement/route.ts:104-117` | Completeness | Outstanding calculated from `invoices.total - payments - credit_notes` instead of Accounts Receivable balance | Customer statement outstanding may not match ledger |
| **R-028** | `app/sales-history/[id]/page.tsx:731-738` | Valuation | Subtotal calculated from `sale_items.line_total` for display, but this is display-only | Low risk - display calculation, but should use authoritative source |

---

## Part 3: Summary Statistics

### Report Classification

- **Total Reports:** 13
- **Ledger-Based:** 4 (31%)
- **Legacy (Ledger-Based but Deprecated):** 3 (23%)
- **Operational Table-Based:** 6 (46%)

### Risk Summary

- **Total Risks:** 28
- **Blocking Risks:** 18 (64%)
- **Corrective Risks:** 10 (36%)

### Risk by Type

- **Completeness:** 12 risks (43%)
- **Valuation:** 10 risks (36%)
- **Timing:** 6 risks (21%)
- **Classification:** 2 risks (7%)

### Risk by Location

| Location | Blocking | Corrective | Total |
|----------|----------|------------|-------|
| `app/api/reports/tax-summary/route.ts` | 2 | 2 | 4 |
| `app/api/reports/aging/route.ts` | 2 | 1 | 3 |
| `app/api/reports/sales-summary/route.ts` | 2 | 1 | 3 |
| `app/reports/vat/page.tsx` | 2 | 2 | 4 |
| `app/reports/registers/page.tsx` | 2 | 1 | 3 |
| `app/admin/retail/analytics/page.tsx` | 4 | 1 | 5 |
| `app/dashboard/page.tsx` | 2 | 0 | 2 |
| `app/invoices/page.tsx` | 1 | 0 | 1 |
| `lib/db/actions/register.ts` | 1 | 0 | 1 |
| `app/api/customers/[id]/statement/route.ts` | 0 | 1 | 1 |
| `app/sales-history/[id]/page.tsx` | 0 | 1 | 1 |

---

## Part 4: Mixed Source Analysis

### Reports with Mixed Origins

**None identified.** All reports use either:
- ✅ Pure ledger sources (journal_entries, journal_entry_lines, trial_balance_snapshots)
- ❌ Pure operational sources (sales, invoices, payments, etc.)

**However, some reports combine multiple operational tables:**
- Tax Summary: `invoices` + `sales` + `expenses` + `bills` + `credit_notes`
- Analytics Dashboard: `sales` + `sale_items` + `cashier_sessions` + `registers`

These are still **non-ledger** but combine multiple operational sources.

---

## Part 5: Critical Findings

### 1. Tax Liability Mismatch Risk
**Reports:** Tax Summary, VAT Report, Analytics Dashboard  
**Issue:** Tax totals calculated from operational tables instead of VAT Payable account (2100)  
**Impact:** Tax liability may not match ledger, leading to incorrect tax returns

### 2. Revenue Mismatch Risk
**Reports:** Sales Summary, Analytics Dashboard, Dashboard, Invoices Page  
**Issue:** Revenue calculated from operational tables instead of Revenue account (4000)  
**Impact:** Revenue KPIs may not match ledger, leading to incorrect financial statements

### 3. Outstanding Amount Mismatch Risk
**Reports:** Aging Report, Dashboard, Customer Statement  
**Issue:** Outstanding calculated from `invoices - payments - credits` instead of Accounts Receivable balance  
**Impact:** Outstanding amounts may not match ledger, leading to incorrect collection strategies

### 4. Register Balance Mismatch Risk
**Reports:** Register Report, Analytics Dashboard  
**Issue:** Register totals calculated from `sales.amount` instead of ledger entries  
**Impact:** Register balances may not match ledger, leading to cash reconciliation issues

### 5. Period Timing Risk
**Reports:** All operational table reports  
**Issue:** Date filtering uses operational table dates (`created_at`, `issue_date`) instead of journal entry dates  
**Impact:** Reports may include/exclude transactions in wrong periods, leading to period misstatements

---

## Conclusion

**46% of financial reports** (6 out of 13) calculate totals from operational tables instead of the ledger. This creates significant accounting risks:

1. **Financial Integrity:** Revenue, tax, and outstanding amounts may not match ledger
2. **Period Accuracy:** Transactions may be included in wrong periods
3. **Reconciliation Issues:** Register and session totals may not reconcile with ledger
4. **Compliance Risk:** Tax reports may not match actual tax liability

**Priority:** Address all 18 BLOCKING risks immediately to ensure financial integrity.
