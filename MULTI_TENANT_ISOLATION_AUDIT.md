# Multi-Tenant Security Audit - Tenant Isolation Assessment

**Date:** 2025-01-27  
**Auditor:** Database Security Review  
**Scope:** All tables scoped by business_id  
**Purpose:** Identify tenant isolation gaps and data leakage risks

---

## Tables with business_id Column

### Accounting Core Tables

| Table Name | Isolation Method | Risk Level | Notes |
|------------|-----------------|------------|-------|
| accounts | DB (RLS via owner_id) | LOW | RLS checks businesses.owner_id = auth.uid() |
| journal_entries | DB (RLS via owner_id) | LOW | RLS checks businesses.owner_id = auth.uid() |
| journal_entry_lines | DB (RLS via join) | MEDIUM | RLS joins through journal_entries to businesses.owner_id |
| accounting_periods | Unknown | HIGH | Has business_id, RLS status unclear - needs verification |
| accounting_balances | Unknown | HIGH | Has business_id column, RLS status unclear |
| ledger_entries | Unknown | HIGH | Has business_id column, RLS status unclear |

### Invoice System Tables

| Table Name | Isolation Method | Risk Level | Notes |
|------------|-----------------|------------|-------|
| customers | DB (RLS via business_users) | MEDIUM | RLS checks business_users.user_id, depends on business_users integrity |
| invoices | DB (RLS via business_users) | MEDIUM | RLS checks business_users.user_id |
| invoice_items | DB (RLS via join) | MEDIUM | RLS joins through invoices to business_users |
| estimates | DB (RLS via business_users) | MEDIUM | RLS checks business_users.user_id |
| estimate_items | DB (RLS via join) | MEDIUM | RLS joins through estimates to business_users |
| recurring_invoices | DB (RLS via business_users) | MEDIUM | RLS checks business_users.user_id |
| credit_notes | DB (RLS via business_users) | MEDIUM | RLS checks business_users.user_id |
| payments | Unknown | HIGH | Has business_id, RLS status unclear - critical financial table |
| invoice_payments | Unknown | HIGH | Payment settlement table, isolation unclear |

### Supplier & Expense Tables

| Table Name | Isolation Method | Risk Level | Notes |
|------------|-----------------|------------|-------|
| bills | Unknown | HIGH | Has business_id, RLS status unclear |
| bill_items | Unknown | HIGH | Joins through bills, isolation unclear |
| bill_payments | Unknown | HIGH | Has business_id, critical payment table |
| expenses | DB (RLS via business_users) | MEDIUM | RLS checks business_users.user_id |
| expense_categories | Unknown | HIGH | Has business_id, isolation unclear |

### Product & Inventory Tables

| Table Name | Isolation Method | Risk Level | Notes |
|------------|-----------------|------------|-------|
| products | Unknown | HIGH | Has business_id, RLS status unclear |
| products_services | DB (RLS via business_users) | MEDIUM | RLS checks business_users.user_id |
| categories | DB (RLS via business_users) | MEDIUM | RLS checks business_users.user_id |
| products_stock | Unknown | HIGH | Has store_id, business_id isolation unclear |
| inventory_movements | Unknown | HIGH | Has business_id, isolation unclear |
| stock_adjustments | Unknown | HIGH | Has business_id, isolation unclear |

### Sales & Orders Tables

| Table Name | Isolation Method | Risk Level | Notes |
|------------|-----------------|------------|-------|
| sales | Unknown | HIGH | Has business_id, RLS status unclear - critical revenue table |
| sale_items | Unknown | HIGH | Joins through sales, isolation unclear |
| orders | Unknown | HIGH | Has business_id, RLS status unclear |
| order_items | Unknown | HIGH | Joins through orders, isolation unclear |
| parked_sales | Unknown | HIGH | Has business_id, isolation unclear |

### Payroll Tables

| Table Name | Isolation Method | Risk Level | Notes |
|------------|-----------------|------------|-------|
| staff | DB (RLS via owner_id) | LOW | RLS checks businesses.owner_id = auth.uid() |
| allowances | DB (RLS via join) | MEDIUM | RLS joins through staff to businesses.owner_id |
| deductions | DB (RLS via join) | MEDIUM | RLS joins through staff to businesses.owner_id |
| payroll_runs | DB (RLS via owner_id) | LOW | RLS checks businesses.owner_id = auth.uid() |
| payroll_entries | DB (RLS via join) | MEDIUM | RLS joins through payroll_runs to businesses.owner_id |
| payslips | DB (RLS via join) | MEDIUM | RLS joins through payroll_runs, also has public_token bypass |

### Asset Management Tables

| Table Name | Isolation Method | Risk Level | Notes |
|------------|-----------------|------------|-------|
| assets | Unknown | HIGH | Has business_id, RLS status unclear |
| depreciation_entries | Unknown | HIGH | Has business_id, isolation unclear |

### Reconciliation Tables

| Table Name | Isolation Method | Risk Level | Notes |
|------------|-----------------|------------|-------|
| bank_transactions | Unknown | HIGH | Has business_id, critical financial table |
| reconciliation_periods | Unknown | HIGH | Has business_id, isolation unclear |

### Tax & Reporting Tables

| Table Name | Isolation Method | Risk Level | Notes |
|------------|-----------------|------------|-------|
| vat_returns | DB (RLS via owner_id) | LOW | RLS checks businesses.owner_id = auth.uid() |
| tax_summaries | Unknown | HIGH | Has business_id, isolation unclear |

### Other Tables

| Table Name | Isolation Method | Risk Level | Notes |
|------------|-----------------|------------|-------|
| stores | Unknown | HIGH | Has business_id, isolation unclear |
| registers | Unknown | HIGH | Has business_id and store_id, isolation unclear |
| business_users | DB (RLS via user_id) | MEDIUM | Core tenant membership table, RLS via auth.uid() |
| business_reminder_settings | Unknown | HIGH | Has business_id, used by background job |
| automations | Unknown | HIGH | Has business_id, isolation unclear |
| audit_logs | Unknown | HIGH | Has business_id, isolation unclear |

---

## Risk Assessment Summary

### HIGH RISK Tables (App-level filtering only, no DB enforcement)

**Critical Financial Tables:**
- payments (payment processing data)
- bill_payments (accounts payable payments)
- sales (revenue transactions)
- bank_transactions (financial reconciliation)
- accounting_periods (period control)
- accounting_balances (ledger balances)

**Data Access Risk:**
- Missing WHERE business_id clause in application code leaks all tenant data
- Background jobs without proper tenant context can access all businesses
- Direct database queries bypass application layer entirely
- SQL injection risks expose cross-tenant data

**Specific Concerns:**
- `/api/reminders/process-automated` background job queries `business_reminder_settings` across ALL businesses without tenant scoping in database
- Application code patterns like `.eq("business_id", businessId)` are applied consistently but are not enforced at DB level for these tables
- No protection against service role queries or direct database access

### MEDIUM RISK Tables (RLS via business_users lookup)

**Tables:**
- customers
- invoices
- invoice_items
- estimates
- estimate_items
- recurring_invoices
- credit_notes
- expenses
- products_services
- categories
- journal_entry_lines (via join)

**Risk Factors:**
- RLS depends on business_users table integrity
- If business_users is corrupted or incorrectly populated, isolation fails
- business_users itself is medium risk (RLS via auth.uid() only, no business_id check)
- Join-based RLS adds query complexity and potential performance issues

**Protection Level:**
- Application-level filtering provides defense-in-depth
- RLS provides database-level protection but relies on correct business_users membership

### LOW RISK Tables (RLS via owner_id direct check)

**Tables:**
- accounts
- journal_entries
- staff
- payroll_runs
- vat_returns

**Protection Level:**
- Strongest isolation method
- Direct check against businesses.owner_id = auth.uid()
- No intermediate table dependencies
- Less vulnerable to data integrity issues

---

## Critical Vulnerabilities Identified

### 1. Background Job Tenant Bypass

**Location:** `/api/reminders/process-automated`

**Issue:**
- Queries `business_reminder_settings` across all businesses
- No RLS on `business_reminder_settings` table
- Processes invoices for all tenants without tenant-scoped database enforcement
- Service role client could expose all business data

**Risk:** HIGH - Background jobs run with elevated privileges and process multiple tenants

### 2. Missing RLS on Critical Financial Tables

**Tables:**
- payments
- sales
- bill_payments
- bank_transactions
- accounting_periods

**Issue:**
- These tables contain sensitive financial data
- No database-level tenant isolation
- Relies entirely on application WHERE clauses
- Direct database access (service role, SQL injection) bypasses all protection

**Risk:** HIGH - Financial data exposure across all tenants

### 3. Join-Based RLS Performance & Integrity Risk

**Tables with join-based RLS:**
- journal_entry_lines → journal_entries → businesses
- invoice_items → invoices → business_users
- estimate_items → estimates → business_users
- payroll_entries → payroll_runs → businesses

**Issue:**
- RLS policies execute joins for every row
- Performance impact on large datasets
- If intermediate table (invoices, journal_entries) is compromised, downstream isolation fails
- Multiple join paths increase complexity

**Risk:** MEDIUM - Performance and integrity dependency risks

### 4. business_users Table as Single Point of Failure

**Issue:**
- Many tables rely on business_users for tenant isolation
- If business_users data is incorrect, isolation fails across multiple tables
- business_users itself has RLS only via auth.uid(), no business_id validation
- No constraint preventing users from being added to wrong businesses

**Risk:** MEDIUM - Core isolation mechanism has integrity dependencies

### 5. Application Code Filtering Patterns

**Pattern:** `.eq("business_id", businessId)`

**Issue:**
- Consistent pattern across application code
- But single missed filter leaks all tenant data
- Code reviews must catch every instance
- No fail-safe at database level for HIGH risk tables

**Risk:** HIGH - Human error in application code exposes all tenants

---

## Tables Requiring Immediate Verification

The following tables have `business_id` columns but RLS status is unclear from migrations reviewed:

1. accounting_periods
2. accounting_balances
3. ledger_entries
4. payments
5. invoice_payments
6. bills
7. bill_items
8. bill_payments
9. expenses (may have RLS, verify)
10. expense_categories
11. products
12. products_stock
13. inventory_movements
14. stock_adjustments
15. sales
16. sale_items
17. orders
18. order_items
19. parked_sales
20. assets
21. depreciation_entries
22. bank_transactions
23. reconciliation_periods
24. stores
25. registers
26. business_reminder_settings
27. automations
28. audit_logs

---

## Recommended Next Steps

1. **Verify RLS Status:** Run queries to check which tables have RLS enabled
2. **Identify Missing Policies:** Determine which HIGH risk tables lack RLS policies
3. **Audit Background Jobs:** Review all scheduled jobs and automated processes for tenant scoping
4. **Application Code Audit:** Review all API routes for consistent business_id filtering
5. **Test Service Role Access:** Verify service role queries are properly scoped
6. **Review business_users Integrity:** Add constraints to prevent incorrect tenant membership

---

**Assessment Complete - No Code Changes Made**
