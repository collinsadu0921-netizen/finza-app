# Migration Fix Summary

## Overview
This document summarizes the fixes applied to resolve schema cache errors and ensure all tables exist with correct structures.

## Migration Created
**File:** `supabase/migrations/051_fix_all_table_structures.sql`

## Tables Fixed/Created

### 1. Expenses Table ✅
**Issues Fixed:**
- Changed `supplier_name` → `supplier`
- Changed `expense_date` → `date`
- Changed `total_amount` → `total`
- Changed `receipt_url` → `receipt_path`
- Added missing Ghana tax fields: `nhil`, `getfund`, `covid`, `vat`
- Added `deleted_at` for soft deletes

### 2. Core Tables ✅
- ✅ `businesses` - Verified and added missing columns
- ✅ `users` - Verified existence
- ✅ `business_users` - Verified existence

### 3. Invoice System Tables ✅
- ✅ `customers` - Verified structure
- ✅ `categories` - Verified structure
- ✅ `products_services` - Verified structure
- ✅ `invoices` - Added missing columns (`apply_taxes`, `public_token`, `currency_code`, `currency_symbol`, `total_tax`)
- ✅ `invoice_items` - Verified structure
- ✅ `payments` - Verified structure

### 4. Bills / Accounts Payable ✅
- ✅ `bills` - Verified and added `total_tax` if missing
- ✅ `bill_items` - Verified structure
- ✅ `bill_payments` - Verified structure

### 5. Credit Notes ✅
- ✅ `credit_notes` - Added `total_tax` and `public_token` if missing
- ✅ `credit_note_items` - Verified structure

### 6. Recurring Invoices ✅
- ✅ `recurring_invoices` - Verified structure

### 7. VAT Returns ✅
- ✅ `vat_returns` - Verified structure

### 8. Assets ✅
- ✅ `assets` - Verified structure
- ✅ `depreciation_entries` - Verified structure

### 9. Payroll ✅
- ✅ `staff` - Verified structure
- ✅ `allowances` - Verified structure
- ✅ `deductions` - Verified structure
- ✅ `payroll_runs` - Verified structure
- ✅ `payroll_entries` - Verified structure
- ✅ `payslips` - Verified structure

### 10. Audit Log ✅
- ✅ `audit_logs` - Verified structure

### 11. Reconciliation ✅
- ✅ `bank_transactions` - Verified structure
- ✅ `reconciliation_periods` - Verified structure

### 12. Accounting / Ledger ✅
- ✅ `accounts` - Verified structure
- ✅ `journal_entries` - Verified structure
- ✅ `journal_entry_lines` - Verified structure

## Key Fixes Applied

1. **Expenses Table Structure**
   - Migrated old column names to new ones
   - Added all Ghana tax breakdown fields
   - Ensured proper data types and constraints

2. **Missing Columns**
   - Added `apply_taxes` to invoices
   - Added `public_token` to invoices and credit_notes
   - Added `total_tax` to bills and credit_notes
   - Added currency fields to invoices

3. **Indexes**
   - Created indexes on all foreign keys
   - Created indexes on frequently queried columns
   - Added partial indexes for soft-deleted records

4. **RLS Policies**
   - Enabled RLS on all tables
   - Created permissive policies (AUTH DISABLED FOR DEVELOPMENT)
   - All tables now allow full access for development

## Column Mappings Fixed

### Expenses Table
| Old Column | New Column | Status |
|------------|------------|--------|
| `supplier_name` | `supplier` | ✅ Migrated |
| `expense_date` | `date` | ✅ Migrated |
| `total_amount` | `total` | ✅ Migrated |
| `receipt_url` | `receipt_path` | ✅ Migrated |
| N/A | `nhil` | ✅ Added |
| N/A | `getfund` | ✅ Added |
| N/A | `covid` | ✅ Added |
| N/A | `vat` | ✅ Added |

## How to Apply

1. **Using Supabase CLI:**
   ```bash
   supabase migration up
   ```

2. **Using Supabase Dashboard:**
   - Go to SQL Editor
   - Copy contents of `051_fix_all_table_structures.sql`
   - Run the migration

3. **Verify Tables Exist:**
   ```sql
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_schema = 'public' 
     AND table_name IN (
       'expenses', 'bills', 'credit_notes', 'vat_returns',
       'assets', 'staff', 'audit_logs', 'accounts',
       'journal_entries', 'journal_entry_lines'
     )
   ORDER BY table_name;
   ```

## Expected Result

After applying this migration:
- ✅ All tables exist with correct structure
- ✅ All columns match code expectations
- ✅ No more "table not found" errors
- ✅ No more "column not found" errors
- ✅ Schema cache will be refreshed automatically
- ✅ All RLS policies are permissive (for development)

## Testing

Run these queries to verify:

```sql
-- Test expenses
SELECT * FROM expenses LIMIT 1;

-- Test bills
SELECT * FROM bills LIMIT 1;

-- Test credit notes
SELECT * FROM credit_notes LIMIT 1;

-- Test vat returns
SELECT * FROM vat_returns LIMIT 1;

-- Test assets
SELECT * FROM assets LIMIT 1;

-- Test staff
SELECT * FROM staff LIMIT 1;

-- Test audit logs
SELECT * FROM audit_logs LIMIT 1;

-- Test accounts
SELECT * FROM accounts LIMIT 1;

-- Test journal entries
SELECT * FROM journal_entries LIMIT 1;

-- Test journal entry lines
SELECT * FROM journal_entry_lines LIMIT 1;
```

All queries should execute without errors.

