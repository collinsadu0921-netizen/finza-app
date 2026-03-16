# Phase 0: Retail v1 Baseline Audit

**Date:** 2026-01-24  
**Purpose:** Document current Retail routes, sidebar entries, receipt flows, and known blockers before implementing fixes.

---

## 1. Retail Routes & Sidebar Entries

### Retail Sidebar Navigation (`components/Sidebar.tsx` lines 194-250)

**Retail Operations:**
- `/retail/dashboard` - Dashboard
- `/pos` - POS Terminal
- `/sales/open-session` - Open Register Session
- `/sales/close-session` - Close Register Session

**Product & Inventory:**
- `/products` - Products
- `/categories` - Categories
- `/inventory` - Inventory
- `/admin/retail/bulk-import` - Bulk Import
- `/admin/retail/low-stock` - Low Stock Report
- `/admin/retail/inventory-dashboard` - Inventory Dashboard

**Sales & Reports:**
- `/admin/retail/analytics` - Analytics Dashboard
- `/sales-history` - Sales History
- `/reports/registers` - Register Reports
- `/reports/vat` - VAT Report

**Customers & Suppliers:**
- `/customers` - Customers
- `/admin/retail/suppliers` - Suppliers
- `/admin/retail/purchase-orders` - Purchase Orders

**Accounting (Conditional - Accountant Firm Users Only):**
- `/accounting/periods` - Accounting Periods ⚠️ **BLOCKER: Visible to Retail users if they are accountant firm users**

**Settings:**
- `/settings/business-profile` - Business Profile
- `/admin/retail/stores` - Stores
- `/settings/registers` - Register Settings
- `/settings/payments` - Payment Settings
- `/settings/staff` - Staff Management

---

## 2. Accounting Routes Visible from Retail

### ⚠️ BLOCKER IDENTIFIED

**Location:** `components/Sidebar.tsx` lines 234-239

```typescript
...(isAccountantFirmUser ? [{
  title: "Accounting",
  items: [
    { label: "Accounting Periods", route: "/accounting/periods", icon: "📅" },
  ],
}] : []),
```

**Issue:** Retail sidebar shows `/accounting/periods` link if user is an accountant firm user, even when in Retail workspace.

**Impact:** Retail users who are also accountant firm users can navigate to accounting routes from Retail sidebar.

**Access Control Status:**
- `lib/accessControl.ts` lines 134-193: Has workspace boundary check that blocks non-firm users from `/accounting/*`
- However, sidebar still shows the link, creating UX confusion

---

## 3. Receipt Send Flows

### Current Implementation

**Receipt Page:** `app/sales/[id]/receipt/page.tsx`
- Lines 186-197: `openSendModal()` function
- Lines 93: Customer state declared but **NEVER SET** ⚠️ **BLOCKER**
- Lines 189-195: Auto-fills from customer if available, but customer is never loaded

**Receipt Send API:** `app/api/receipts/send/route.ts`
- Lines 48-75: Loads sale with customer join
- Lines 99: Uses `sale.customers` for receipt data
- **Works correctly** - API has customer data

**Problem:** Receipt page UI never loads customer record, so `openSendModal()` cannot pre-fill customer contact info.

**Expected Behavior:**
1. Load sale with `customer_id`
2. If `customer_id` exists, fetch customer record
3. Pre-fill email/phone in send modal
4. Allow manual override

**Current Behavior:**
1. Load sale with `customer_id`
2. Customer state remains `null` (never fetched)
3. Send modal opens with empty fields
4. User must manually enter contact info

---

## 4. Sale Posting / Tax / Inventory Write Paths

### Sale Creation Flow

**API Route:** `app/api/sales/create/route.ts`
- Lines 36-1460: Main sale creation handler
- Lines 156-191: Tax validation (requires `tax_lines`, `tax_engine_code`, etc.)
- Lines 300-400: Store context resolution
- Lines 400-600: Inventory decrement logic
- Lines 800-1000: Sale record creation
- Lines 1000-1200: Ledger posting via `post_sale_to_ledger()`

### Ledger Posting

**Database Function:** `supabase/migrations/094_accounting_periods.sql` lines 503-632
- Function: `post_sale_to_ledger(p_sale_id UUID)`
- Reads `sale.tax_lines` JSONB (canonical source)
- Posts to cash account (debit), revenue account (credit), tax accounts (credit)
- Uses `tax_lines[].ledger_account_code` and `tax_lines[].ledger_side`

**Status:** ✅ **Working correctly** - uses canonical tax_lines format

### Inventory Decrement

**Location:** `app/api/sales/create/route.ts` lines 400-600
- Decrements `products_stock.stock_quantity` by sale item quantity
- Scoped by `store_id`, `product_id`, `variant_id`
- Uses service role client for RLS bypass

**Status:** ✅ **Working correctly** - stock decrements on sale

### Discounts

**Validation:** `lib/discounts/validation.ts`
- Line discounts: `validateLineDiscount()`
- Cart discounts: `validateCartDiscount()`
- Total discount caps: `validateTotalDiscount()`
- Role limits: `getRoleDiscountLimit()`

**Calculation:** `lib/discounts/calculator.ts`
- `calculateDiscounts()` - applies line and cart discounts
- Returns `subtotal_before_discount`, `total_discount`, `subtotal_after_discount`

**Status:** ✅ **Already implemented** - Phase 1 Advanced Discounts complete

---

## 5. Known Blockers

### Blocker 1: Workspace Boundary Leakage
**Severity:** HIGH  
**Location:** `components/Sidebar.tsx` lines 234-239  
**Issue:** Retail sidebar shows `/accounting/periods` link for accountant firm users  
**Fix Required:** Remove accounting links from Retail sidebar entirely

### Blocker 2: Access Control Not Enforced Early
**Severity:** MEDIUM  
**Location:** `lib/accessControl.ts` lines 134-193  
**Issue:** Access control happens in `resolveAccess()` but may allow render before redirect  
**Fix Required:** Add middleware or early redirect in page components

### Blocker 3: Receipt Customer Hydration Missing
**Severity:** HIGH  
**Location:** `app/sales/[id]/receipt/page.tsx`  
**Issue:** Customer state declared but never loaded, so receipt send modal cannot pre-fill contact info  
**Fix Required:** Load customer record when `sale.customer_id` exists

---

## 6. Retail v1 Freeze Checklist Feasibility

✅ **Workspace Boundaries:** Can be enforced via:
- Sidebar cleanup (remove accounting links)
- Access control hardening (early redirect)
- Page-level guards (defense-in-depth)

✅ **Receipt Hydration:** Can be fixed by:
- Loading customer in `loadReceipt()` function
- Pre-filling send modal fields from customer record

✅ **Sale Flow Hardening:** Already working:
- Discounts implemented and validated
- Inventory decrements correctly
- Ledger posting uses canonical tax_lines

✅ **CI Guards:** Can be added:
- Check for `/accounting/*` routes in Retail sidebar
- Check for accounting imports in Retail routes

---

## 7. Files Requiring Changes

### Phase 1 (Workspace Boundaries)
1. `components/Sidebar.tsx` - Remove accounting links from Retail sidebar
2. `lib/accessControl.ts` - Already has guard, verify it's working
3. `app/accounting/periods/page.tsx` - Add page-level redirect if needed

### Phase 2 (Receipt Hydration)
1. `app/sales/[id]/receipt/page.tsx` - Load customer record in `loadReceipt()`

### Phase 3 (Verification)
1. No code changes needed - verify existing flows work

### Phase 4 (Freeze)
1. Create `RETAIL_FREEZE.md`
2. Add CI check (optional but recommended)

---

## 8. Summary

**Current State:**
- Retail sale flow is functional (discounts, inventory, posting all work)
- Workspace boundaries exist but have UX leakage (sidebar shows accounting links)
- Receipt send flow is broken (customer not loaded)

**Blockers:**
1. Sidebar shows accounting link to Retail users (if they're accountant firm users)
2. Receipt page doesn't load customer, so send modal can't pre-fill

**Feasibility:** ✅ All fixes are straightforward and low-risk

**Next Steps:** Proceed with Phase 1-4 implementation.
