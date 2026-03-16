# Cash Office Report & Financial Totals Audit

**Date:** 2026-01-27  
**Purpose:** Comprehensive scan for deprecated Cash Office Report references and financial totals calculated outside the ledger

---

## Part 1: Cash Office Report References

### Summary
- **Route Deleted:** ✅ `/api/reports/cash-office/route.ts` (marked as deleted in git)
- **Page Deleted:** ✅ `/app/reports/cash-office/page.tsx` (marked as deleted in git)
- **UI Menu:** ❌ **NOT FOUND** - No menu items in Sidebar.tsx
- **Function Still Exists:** ⚠️ `hasAccessToCashOffice()` function still used for authorization checks

### Detailed Findings

| Location | Type | Reachable | Notes |
|----------|------|-----------|-------|
| `lib/userRoles.ts:39` | Function | Yes | `hasAccessToCashOffice()` - Used for authorization, not UI |
| `app/sales-history/page.tsx:8,224` | UI | Yes | Uses `hasAccessToCashOffice()` for access control |
| `app/sales-history/[id]/page.tsx:8,139` | UI | Yes | Uses `hasAccessToCashOffice()` for access control |
| `app/sales-history/[id]/receipt/page.tsx:8` | UI | Yes | Imports but may not use (verify) |
| Documentation files (multiple) | Docs | No | Various .md files reference cash office in historical context |

### Function Usage Analysis

**Function:** `hasAccessToCashOffice(supabase, userId, businessId)`

**Purpose:** Authorization check - allows `owner`, `admin`, `manager`, `employee` roles

**Current Usage:**
- ✅ Used in Sales History pages for access control
- ✅ NOT used for cash office report (report is deleted)
- ⚠️ Function name is misleading - should be renamed to `hasAccessToSalesHistory()` or similar

**Recommendation:**
- Rename function to better reflect current usage
- Or keep if planning to restore cash office functionality

---

## Part 2: Financial Totals Calculated Outside Ledger

### Summary
**CRITICAL FINDINGS:** Multiple locations calculate financial totals directly from operational tables (`sales`, `payments`, `registers`, `cashier_sessions`) without using `journal_entries` or `journal_entry_lines`.

### Severity Classification

#### 🔴 BLOCKING (Must Fix - Financial Integrity Risk)

| File Path | Fields Used | Purpose | Shown to User | Notes |
|-----------|-------------|---------|---------------|-------|
| `app/dashboard/page.tsx:400` | `payments.amount` | Total revenue calculation | ✅ Yes | Sums all payments for revenue KPI |
| `app/invoices/page.tsx:426-431` | `payments.amount` | Total revenue calculation | ✅ Yes | Calculates revenue from payments table |
| `app/admin/retail/analytics/page.tsx:451-483` | `sale_items.qty, price, cogs`<br>`sales.tax_lines` | Revenue, COGS, VAT, Gross Profit | ✅ Yes | Analytics dashboard KPIs - all calculated from sales/sale_items |
| `app/admin/retail/analytics/page.tsx:711-725` | `sales.amount` | Session sales totals | ✅ Yes | Sums sales.amount per cashier session |
| `app/reports/registers/page.tsx:86-153` | `sales.amount, payment_method` | Register totals by payment method | ✅ Yes | Calculates register statistics from sales table |
| `lib/db/actions/register.ts:52-70` | `sales.amount, cash_amount, change_given` | Expected cash calculation | ⚠️ Validation | Used for register variance calculation |

#### 🟡 CORRECTIVE (Should Fix - Data Consistency Risk)

| File Path | Fields Used | Purpose | Shown to User | Notes |
|-----------|-------------|---------|---------------|-------|
| `app/api/customers/[id]/statement/route.ts:104-117` | `invoices.total`<br>`payments.amount`<br>`credit_notes.total` | Outstanding amount calculation | ✅ Yes | Calculates outstanding from invoices - payments - credits |
| `app/dashboard/page.tsx:375-425` | `invoices.total`<br>`payments.amount`<br>`credit_notes.total` | Outstanding and overdue calculations | ✅ Yes | Service dashboard outstanding amounts |
| `app/sales-history/[id]/page.tsx:731-738` | `sale_items.line_total` | Subtotal and revenue display | ✅ Yes | Client-side calculation for display |
| `app/api/reports/tax-summary/route.ts:186-198` | `sales.total_tax, tax_lines` | Tax totals for summary report | ✅ Yes | Calculates tax from sales table |

#### 🟢 INFORMATIONAL (Low Priority - Display Only)

| File Path | Fields Used | Purpose | Shown to User | Notes |
|-----------|-------------|---------|---------------|-------|
| `app/sales/[id]/receipt/page.tsx:598-607` | `sale.amount, sale.tax_lines` | Receipt display totals | ✅ Yes | Display calculation, uses authoritative `sale.amount` |
| `app/sales-history/[id]/receipt/page.tsx:279-295` | `sale.amount, sale.tax_lines` | Receipt reprint totals | ✅ Yes | Display calculation, uses authoritative `sale.amount` |

---

## Detailed Analysis by Category

### 1. Revenue Calculations (BLOCKING)

#### `app/dashboard/page.tsx` (Service Dashboard)
```typescript
// Line 400
const totalRevenue = allPayments?.reduce((sum, p) => sum + Number(p.amount || 0), 0) || 0
```
- **Issue:** Calculates revenue from `payments` table
- **Should Use:** `journal_entry_lines` where `account_code = '4000'` (Revenue account)
- **Impact:** Revenue may not match ledger if payments exist without journal entries

#### `app/invoices/page.tsx` (Invoices Page)
```typescript
// Lines 426-431
const { data: payments } = await supabase
  .from("payments")
  .select("amount")
  .eq("business_id", businessId)
  .is("deleted_at", null)

const revenue = payments?.reduce((sum, p) => sum + Number(p.amount || 0), 0) || 0
```
- **Issue:** Same pattern - calculates from payments table
- **Should Use:** Ledger revenue account balance
- **Impact:** Revenue KPI may be incorrect

#### `app/admin/retail/analytics/page.tsx` (Retail Analytics)
```typescript
// Lines 451-461
saleItems.forEach((item) => {
  const revenue = Number(item.qty || 0) * Number(item.price || 0)
  totalRevenue += revenue
  totalCogs += Number(item.cogs || 0)
})
```
- **Issue:** Calculates revenue from `sale_items` table
- **Should Use:** `journal_entry_lines` where `account_code = '4000'` (Revenue)
- **Impact:** Analytics dashboard shows incorrect revenue/COGS/profit

### 2. Register/Session Totals (BLOCKING)

#### `app/reports/registers/page.tsx`
```typescript
// Lines 120-153
for (const sale of sales || []) {
  const amount = Number(sale.amount || 0)
  stats.total_sales += amount
  stats.transaction_count += 1
  
  // Payment method breakdown
  if (method === "cash") stats.cash_total += amount
  // ... etc
}
```
- **Issue:** Calculates register totals from `sales` table
- **Should Use:** `journal_entry_lines` grouped by register/session
- **Impact:** Register report may not match ledger balances

#### `app/admin/retail/analytics/page.tsx` (Session Totals)
```typescript
// Lines 711-725
const { data: sessionSales } = await supabase
  .from("sales")
  .select("cashier_session_id, amount")
  .in("cashier_session_id", sessionIds)
  .eq("payment_status", "paid")

sessionSales?.forEach((sale) => {
  const existing = sessionSalesMap.get(sale.cashier_session_id) || 0
  sessionSalesMap.set(sale.cashier_session_id, existing + Number(sale.amount || 0))
})
```
- **Issue:** Calculates session totals from sales table
- **Should Use:** `journal_entry_lines` filtered by session metadata
- **Impact:** Session analytics may be incorrect

### 3. Outstanding Amount Calculations (CORRECTIVE)

#### `app/dashboard/page.tsx` & `app/api/customers/[id]/statement/route.ts`
```typescript
// Pattern: outstanding = invoice.total - sum(payments) - sum(credit_notes)
const outstandingAmount = Math.max(0, Number(inv.total || 0) - totalPaid - totalCredits)
```
- **Issue:** Calculates outstanding from operational tables
- **Should Use:** Ledger account balances (Accounts Receivable)
- **Impact:** Outstanding amounts may not match ledger if journal entries are missing

### 4. Tax Calculations (CORRECTIVE)

#### `app/api/reports/tax-summary/route.ts`
```typescript
// Lines 186-198
sales.forEach((sale) => {
  const saleTotalTax = sale.total_tax ?? (sale.tax_lines ? sumTaxLines(sale.tax_lines) : 0)
  salesTotalTax += saleTotalTax
})
```
- **Issue:** Calculates tax from sales table
- **Should Use:** `journal_entry_lines` where `account_code = '2100'` (VAT Payable)
- **Impact:** Tax summary may not match ledger tax liability

---

## Recommendations

### Immediate Actions (BLOCKING)

1. **Replace Revenue Calculations**
   - `app/dashboard/page.tsx` → Use ledger revenue account (4000)
   - `app/invoices/page.tsx` → Use ledger revenue account (4000)
   - `app/admin/retail/analytics/page.tsx` → Use ledger revenue account (4000)

2. **Replace Register/Session Totals**
   - `app/reports/registers/page.tsx` → Query `journal_entry_lines` with register/session filters
   - `app/admin/retail/analytics/page.tsx` → Query `journal_entry_lines` for session totals

3. **Replace COGS Calculations**
   - `app/admin/retail/analytics/page.tsx` → Use ledger COGS account (5000) instead of `sale_items.cogs`

### Short-term Actions (CORRECTIVE)

1. **Outstanding Amount Calculations**
   - Create ledger-based outstanding calculation function
   - Replace in `app/dashboard/page.tsx` and `app/api/customers/[id]/statement/route.ts`

2. **Tax Summary Report**
   - `app/api/reports/tax-summary/route.ts` → Use VAT Payable account (2100) from ledger

### Long-term Actions

1. **Function Rename**
   - Rename `hasAccessToCashOffice()` to `hasAccessToSalesHistory()` or `hasAccessToRetailReports()`

2. **Create Ledger Query Helpers**
   - `lib/ledger/queries.ts` - Helper functions for common ledger queries
   - Functions: `getRevenueTotal()`, `getTaxTotal()`, `getRegisterTotal()`, etc.

---

## Files Requiring Changes

### High Priority (Financial Integrity)
1. `app/dashboard/page.tsx`
2. `app/invoices/page.tsx`
3. `app/admin/retail/analytics/page.tsx`
4. `app/reports/registers/page.tsx`
5. `lib/db/actions/register.ts`

### Medium Priority (Data Consistency)
6. `app/api/customers/[id]/statement/route.ts`
7. `app/api/reports/tax-summary/route.ts`

### Low Priority (Code Quality)
8. `lib/userRoles.ts` (function rename)

---

## Validation Queries

To verify ledger completeness, run these queries:

```sql
-- Check if all sales have journal entries
SELECT COUNT(*) as sales_without_journal
FROM sales s
LEFT JOIN journal_entries je ON je.reference_id = s.id AND je.reference_type = 'sale'
WHERE s.payment_status = 'paid'
  AND je.id IS NULL;

-- Check if all payments have journal entries
SELECT COUNT(*) as payments_without_journal
FROM payments p
LEFT JOIN journal_entries je ON je.reference_id = p.id AND je.reference_type = 'payment'
WHERE p.deleted_at IS NULL
  AND je.id IS NULL;

-- Compare revenue from sales vs ledger
SELECT 
  (SELECT COALESCE(SUM(amount), 0) FROM sales WHERE payment_status = 'paid') as sales_total,
  (SELECT COALESCE(SUM(credit), 0) FROM journal_entry_lines jel
   JOIN accounts a ON a.id = jel.account_id
   WHERE a.code = '4000') as ledger_revenue;
```

---

## Conclusion

**Cash Office Report:** ✅ Successfully removed (route and page deleted). Only authorization function remains (misleading name).

**Financial Totals:** ❌ **CRITICAL ISSUE** - Multiple locations calculate totals from operational tables instead of ledger. This creates risk of:
- Revenue discrepancies
- Tax liability mismatches
- Register balance inconsistencies
- Analytics dashboard inaccuracies

**Priority:** Fix BLOCKING issues immediately to ensure financial integrity.
